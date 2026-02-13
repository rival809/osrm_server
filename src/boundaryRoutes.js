/**
 * Administrative Boundary API Routes
 *
 * GET  /api/boundaries/:level          → GeoJSON FeatureCollection
 * GET  /api/boundaries/detail/:id      → Single Feature with children
 * GET  /api/boundaries/lookup          → Point-in-polygon lookup
 * POST /api/boundaries/split           → Permanently split a polygon
 * POST /api/boundaries/merge           → Merge polygons back together
 */

const express = require('express');
const { query, body, param, validationResult } = require('express-validator');
const { pool } = require('./db');
const logger = require('./logger');

const router = express.Router();

// ─── helpers ───────────────────────────────────────────────────

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
  }
  next();
};

/** Map zoom level → simplification tolerance (degrees) */
function simplifyForZoom(zoom) {
  if (zoom == null) return 0.001;
  const z = parseInt(zoom);
  if (z >= 14) return 0.00005;  // ~5 m   – street level
  if (z >= 12) return 0.0002;   // ~20 m
  if (z >= 10) return 0.001;    // ~100 m
  if (z >= 8)  return 0.005;    // ~500 m
  return 0.01;                   // ~1 km   – overview
}

// ─── GET /api/boundaries/:level ────────────────────────────────
// level = province | city | district
// Optional query params: parent_code, zoom, bbox (minLon,minLat,maxLon,maxLat)

router.get(
  '/:level',
  [
    param('level').isIn(['province', 'city', 'district']).withMessage('Level must be province, city, or district'),
    query('parent_code').optional().isString(),
    query('zoom').optional().isInt({ min: 0, max: 20 }),
    query('bbox').optional().matches(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/),
    handleValidation,
  ],
  async (req, res) => {
    const startTime = Date.now();
    const { level } = req.params;
    const { parent_code, zoom, bbox } = req.query;

    try {
      const simplify = simplifyForZoom(zoom);

      let bboxGeom = null;
      if (bbox) {
        const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number);
        bboxGeom = `ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`;
      }

      const sql = `
        SELECT fn_get_boundaries_geojson(
          $1::admin_level_enum,
          $2,
          $3,
          ${bboxGeom || 'NULL'}
        ) AS geojson
      `;

      const { rows } = await pool.query(sql, [level, parent_code || null, simplify]);

      const geojson = rows[0].geojson;
      const elapsed = Date.now() - startTime;

      logger.info('Boundaries fetched', { level, parent_code, features: geojson.features?.length, ms: elapsed });

      res.set('Cache-Control', 'public, max-age=300'); // 5 min cache
      res.json({
        success: true,
        responseTime: `${elapsed}ms`,
        level,
        parent_code: parent_code || null,
        simplify,
        ...geojson,
      });
    } catch (err) {
      logger.error('Boundaries error', { error: err.message, level, parent_code });
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── GET /api/boundaries/detail/:id ────────────────────────────

router.get(
  '/detail/:id',
  [
    param('id').isInt({ min: 1 }).withMessage('ID must be a positive integer'),
    query('zoom').optional().isInt({ min: 0, max: 20 }),
    handleValidation,
  ],
  async (req, res) => {
    const startTime = Date.now();
    const { id } = req.params;
    const simplify = simplifyForZoom(req.query.zoom);

    try {
      const { rows } = await pool.query(
        'SELECT fn_get_boundary_detail($1, $2) AS feature',
        [parseInt(id), simplify],
      );

      if (!rows[0].feature) {
        return res.status(404).json({ success: false, error: 'Boundary not found' });
      }

      const elapsed = Date.now() - startTime;
      logger.info('Boundary detail', { id, ms: elapsed });

      res.json({ success: true, responseTime: `${elapsed}ms`, ...rows[0].feature });
    } catch (err) {
      logger.error('Boundary detail error', { error: err.message, id });
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── GET /api/boundaries/lookup ────────────────────────────────
// Find which boundary a coordinate falls within
// Query: lat, lon, level (optional)

router.get(
  '/lookup',
  [
    query('lat').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
    query('lon').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
    query('level').optional().isIn(['province', 'city', 'district']),
    handleValidation,
  ],
  async (req, res) => {
    const startTime = Date.now();
    const { lat, lon, level } = req.query;

    try {
      const { rows } = await pool.query(
        'SELECT * FROM fn_find_boundary_at_point($1, $2, $3::admin_level_enum)',
        [parseFloat(lon), parseFloat(lat), level || null],
      );

      const elapsed = Date.now() - startTime;
      res.json({
        success: true,
        responseTime: `${elapsed}ms`,
        coordinates: { lat: parseFloat(lat), lon: parseFloat(lon) },
        results: rows,
      });
    } catch (err) {
      logger.error('Boundary lookup error', { error: err.message, lat, lon });
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── POST /api/boundaries/split ────────────────────────────────
// Body: {
//   boundary_id: 5,
//   cut_line: { type: "LineString", coordinates: [[lon,lat],[lon,lat],...] },
//   new_regions: [ { name: "Region A", code: "32.73.01A" }, ... ],
//   performed_by: "admin"
// }

router.post(
  '/split',
  [
    body('boundary_id').isInt({ min: 1 }).withMessage('boundary_id must be a positive integer'),
    body('cut_line').isObject().withMessage('cut_line must be a GeoJSON LineString'),
    body('cut_line.type').equals('LineString').withMessage('cut_line.type must be LineString'),
    body('cut_line.coordinates').isArray({ min: 2 }).withMessage('cut_line needs at least 2 coordinate pairs'),
    body('new_regions').isArray({ min: 2 }).withMessage('Provide at least 2 new_regions'),
    body('new_regions.*.name').notEmpty().withMessage('Each new_region needs a name'),
    body('new_regions.*.code').notEmpty().withMessage('Each new_region needs a code'),
    body('performed_by').optional().isString(),
    handleValidation,
  ],
  async (req, res) => {
    const startTime = Date.now();
    const { boundary_id, cut_line, new_regions, performed_by } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const names = new_regions.map((r) => r.name);
      const codes = new_regions.map((r) => r.code);
      const lineGeom = JSON.stringify(cut_line);

      const sql = `
        SELECT * FROM fn_split_boundary(
          $1,
          ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
          $3::text[],
          $4::text[],
          $5
        )
      `;

      const { rows } = await client.query(sql, [
        boundary_id,
        lineGeom,
        names,
        codes,
        performed_by || 'api',
      ]);

      await client.query('COMMIT');

      const elapsed = Date.now() - startTime;
      logger.info('Boundary split completed', { boundary_id, pieces: rows.length, ms: elapsed });

      res.json({
        success: true,
        responseTime: `${elapsed}ms`,
        message: `Boundary split into ${rows.length} new regions`,
        original_id: boundary_id,
        new_regions: rows,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Boundary split error', { error: err.message, boundary_id });
      res.status(400).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  },
);

// ─── POST /api/boundaries/merge ────────────────────────────────
// Body: { boundary_ids: [5,6], new_name: "Merged Region", new_code: "32.73.X" }

router.post(
  '/merge',
  [
    body('boundary_ids').isArray({ min: 2 }).withMessage('Provide at least 2 boundary_ids'),
    body('boundary_ids.*').isInt({ min: 1 }),
    body('new_name').notEmpty().withMessage('new_name is required'),
    body('new_code').notEmpty().withMessage('new_code is required'),
    body('performed_by').optional().isString(),
    handleValidation,
  ],
  async (req, res) => {
    const startTime = Date.now();
    const { boundary_ids, new_name, new_code, performed_by } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        'SELECT fn_merge_boundaries($1::int[], $2, $3, $4) AS new_id',
        [boundary_ids, new_name, new_code, performed_by || 'api'],
      );

      await client.query('COMMIT');

      const elapsed = Date.now() - startTime;
      logger.info('Boundary merge completed', { boundary_ids, new_id: rows[0].new_id, ms: elapsed });

      res.json({
        success: true,
        responseTime: `${elapsed}ms`,
        message: `Merged ${boundary_ids.length} boundaries into a new region`,
        merged_ids: boundary_ids,
        new_id: rows[0].new_id,
        new_name,
        new_code,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Boundary merge error', { error: err.message, boundary_ids });
      res.status(400).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  },
);

module.exports = router;
