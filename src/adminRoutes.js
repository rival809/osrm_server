/**
 * Admin Boundary Routes  (requires Bearer token auth)
 *
 * GET    /api/admin/boundaries              → list all (no simplify, no cache)
 * GET    /api/admin/boundaries/:id          → single boundary full detail
 * POST   /api/admin/boundaries              → create new boundary
 * PUT    /api/admin/boundaries/:id          → update metadata (name, code, population…)
 * PUT    /api/admin/boundaries/:id/geometry → replace geometry (GeoJSON)
 * DELETE /api/admin/boundaries/:id          → soft-delete (is_active = false)
 * GET    /api/admin/boundaries/:id/history  → split/merge history for a boundary
 * GET    /api/admin/history                 → full audit log (split_history table)
 */

const express    = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { pool }   = require('./db');
const logger     = require('./logger');
const { requireAuth } = require('./adminAuth');

const router = express.Router();

// Apply auth to every admin boundary route
router.use(requireAuth);

// ─── helpers ────────────────────────────────────────────────────────────────

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
  }
  next();
};

const LEVELS = ['province', 'city', 'district', 'village'];

// ─── GET /api/admin/history ──────────────────────────────────────────────────
// Full audit log — defined FIRST so it doesn't get swallowed by /:id

router.get('/history', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT h.*,
              ab.name AS result_names
       FROM boundary_split_history h
       LEFT JOIN LATERAL (
         SELECT string_agg(name, ', ') AS name
         FROM administrative_boundaries WHERE id = ANY(h.result_ids)
       ) ab ON TRUE
       ORDER BY h.performed_at DESC
       LIMIT 200`,
    );
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    logger.error('[AdminBoundary] full history error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/admin/boundaries ──────────────────────────────────────────────
// Query params: level, parent_code, include_inactive

router.get(
  '/',
  [
    query('level').optional().isIn(LEVELS),
    query('parent_code').optional().isString(),
    query('include_inactive').optional().isBoolean(),
    validate,
  ],
  async (req, res) => {
    const { level, parent_code, include_inactive } = req.query;
    try {
      let conditions = ['1=1'];
      const params   = [];
      let p = 1;

      if (level) {
        conditions.push(`admin_level = $${p++}::admin_level_enum`);
        params.push(level);
      }
      if (parent_code) {
        conditions.push(`parent_id = (SELECT id FROM administrative_boundaries WHERE code = $${p++} LIMIT 1)`);
        params.push(parent_code);
      }
      if (include_inactive !== 'true') {
        conditions.push(`is_active = TRUE`);
      }

      const sql = `
        SELECT
          id, parent_id, admin_level, code, name, alt_name,
          ROUND(area_km2::numeric, 2) AS area_km2,
          population, metadata, is_active,
          created_at, updated_at
        FROM administrative_boundaries
        WHERE ${conditions.join(' AND ')}
        ORDER BY admin_level, name
      `;

      const { rows } = await pool.query(sql, params);
      res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
      logger.error('[AdminBoundary] list error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── GET /api/admin/boundaries/:id ──────────────────────────────────────────

router.get(
  '/:id',
  [ param('id').isInt({ min: 1 }), validate ],
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT
           b.*,
           ST_AsGeoJSON(b.geom)::json AS geometry,
           p.name AS parent_name, p.code AS parent_code
         FROM administrative_boundaries b
         LEFT JOIN administrative_boundaries p ON p.id = b.parent_id
         WHERE b.id = $1`,
        [parseInt(req.params.id)],
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      logger.error('[AdminBoundary] get error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── POST /api/admin/boundaries ─────────────────────────────────────────────
// Body: { admin_level, code, name, alt_name?, parent_id?, population?, metadata?, geometry: GeoJSON }

router.post(
  '/',
  [
    body('admin_level').isIn(LEVELS).withMessage('Invalid admin_level'),
    body('code').notEmpty().withMessage('code is required'),
    body('name').notEmpty().withMessage('name is required'),
    body('parent_id').optional({ nullable: true }).isInt({ min: 1 }),
    body('population').optional({ nullable: true }).isInt({ min: 0 }),
    body('alt_name').optional().isString(),
    body('metadata').optional().isObject(),
    body('geometry').isObject().withMessage('geometry (GeoJSON) is required'),
    body('geometry.type').isIn(['Polygon', 'MultiPolygon']).withMessage('geometry.type must be Polygon or MultiPolygon'),
    validate,
  ],
  async (req, res) => {
    const { admin_level, code, name, alt_name, parent_id, population, metadata, geometry } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check duplicate code
      const dup = await client.query('SELECT id FROM administrative_boundaries WHERE code = $1', [code]);
      if (dup.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: `Code "${code}" already exists (id=${dup.rows[0].id})` });
      }

      // Convert Polygon → MultiPolygon automatically
      const geomSql = `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))`;

      const { rows } = await client.query(
        `INSERT INTO administrative_boundaries
           (admin_level, code, name, alt_name, parent_id, population, metadata, geom)
         VALUES ($2::admin_level_enum, $3, $4, $5, $6, $7, $8, ${geomSql})
         RETURNING id, code, name, admin_level, area_km2`,
        [
          JSON.stringify(geometry),
          admin_level, code, name,
          alt_name || null,
          parent_id || null,
          population || null,
          metadata ? JSON.stringify(metadata) : '{}',
        ],
      );

      await client.query('COMMIT');
      logger.info('[AdminBoundary] created', { id: rows[0].id, code });
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('[AdminBoundary] create error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  },
);

// ─── PUT /api/admin/boundaries/:id ──────────────────────────────────────────
// Update metadata only (name, alt_name, code, population, metadata, parent_id, is_active)

router.put(
  '/:id',
  [
    param('id').isInt({ min: 1 }),
    body('name').optional().notEmpty(),
    body('alt_name').optional(),
    body('code').optional().notEmpty(),
    body('population').optional({ nullable: true }).isInt({ min: 0 }),
    body('parent_id').optional({ nullable: true }).isInt({ min: 1 }),
    body('metadata').optional().isObject(),
    body('is_active').optional().isBoolean(),
    validate,
  ],
  async (req, res) => {
    const id = parseInt(req.params.id);
    const fields  = ['name', 'alt_name', 'code', 'population', 'parent_id', 'metadata', 'is_active'];
    const updates = [];
    const params  = [];
    let p = 1;

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        const val = f === 'metadata' ? JSON.stringify(req.body[f]) : req.body[f];
        updates.push(`${f} = $${p++}`);
        params.push(val);
      }
    }

    if (!updates.length) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    params.push(id);
    try {
      const { rows } = await pool.query(
        `UPDATE administrative_boundaries
         SET ${updates.join(', ')}
         WHERE id = $${p}
         RETURNING id, code, name, admin_level, alt_name, population, metadata, is_active, updated_at`,
        params,
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      logger.info('[AdminBoundary] updated metadata', { id });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      logger.error('[AdminBoundary] update error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── PUT /api/admin/boundaries/:id/geometry ─────────────────────────────────
// Body: { geometry: GeoJSON Polygon or MultiPolygon }

router.put(
  '/:id/geometry',
  [
    param('id').isInt({ min: 1 }),
    body('geometry').isObject().withMessage('geometry (GeoJSON) is required'),
    body('geometry.type').isIn(['Polygon', 'MultiPolygon']).withMessage('geometry.type must be Polygon or MultiPolygon'),
    validate,
  ],
  async (req, res) => {
    const id = parseInt(req.params.id);
    const { geometry } = req.body;

    try {
      const { rows } = await pool.query(
        `UPDATE administrative_boundaries
         SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))
         WHERE id = $2
         RETURNING id, code, name, ROUND(area_km2::numeric, 2) AS area_km2, updated_at`,
        [JSON.stringify(geometry), id],
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      logger.info('[AdminBoundary] geometry updated', { id });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      logger.error('[AdminBoundary] geometry update error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── DELETE /api/admin/boundaries/:id ───────────────────────────────────────
// Soft-delete: sets is_active = false (hard delete if ?hard=true)

router.delete(
  '/:id',
  [ param('id').isInt({ min: 1 }), query('hard').optional().isBoolean(), validate ],
  async (req, res) => {
    const id   = parseInt(req.params.id);
    const hard = req.query.hard === 'true';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Prevent deleting if it has active children
      const children = await client.query(
        'SELECT COUNT(*) AS cnt FROM administrative_boundaries WHERE parent_id = $1 AND is_active = TRUE',
        [id],
      );
      if (parseInt(children.rows[0].cnt) > 0 && !hard) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          error: `Boundary has ${children.rows[0].cnt} active children. Deactivate them first or use ?hard=true to force.`,
        });
      }

      let result;
      if (hard) {
        result = await client.query(
          'DELETE FROM administrative_boundaries WHERE id = $1 RETURNING id, code, name',
          [id],
        );
      } else {
        result = await client.query(
          'UPDATE administrative_boundaries SET is_active = FALSE WHERE id = $1 RETURNING id, code, name, is_active',
          [id],
        );
      }

      await client.query('COMMIT');

      if (!result.rows.length) {
        return res.status(404).json({ success: false, error: 'Not found' });
      }

      logger.info('[AdminBoundary] deleted', { id, hard });
      res.json({ success: true, deleted: result.rows[0], hard });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('[AdminBoundary] delete error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  },
);

// ─── GET /api/admin/boundaries/:id/history ──────────────────────────────────

router.get(
  '/:id/history',
  [ param('id').isInt({ min: 1 }), validate ],
  async (req, res) => {
    const id = parseInt(req.params.id);
    try {
      const { rows } = await pool.query(
        `SELECT h.*, ab.name AS result_names
         FROM boundary_split_history h
         LEFT JOIN LATERAL (
           SELECT string_agg(name, ', ') AS name
           FROM administrative_boundaries
           WHERE id = ANY(h.result_ids)
         ) ab ON TRUE
         WHERE h.source_id = $1
         ORDER BY h.performed_at DESC`,
        [id],
      );
      res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
      logger.error('[AdminBoundary] history error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

module.exports = router;
