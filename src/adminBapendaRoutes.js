/**
 * Admin Bapenda Boundary Routes  (requires Bearer token auth)
 *
 * Uses Bapenda tables: province_boundaries, district_boundaries, village_boundaries
 * Kode yang dipakai: kd_wil (p3d_id) bukan BPS-style dot notation
 *
 * GET    /api/admin/bapenda/kabupaten                    → list province_boundaries
 * GET    /api/admin/bapenda/kabupaten/:id                → single + full geometry
 * POST   /api/admin/bapenda/kabupaten                    → create
 * PUT    /api/admin/bapenda/kabupaten/:id                → update metadata
 * PUT    /api/admin/bapenda/kabupaten/:id/geometry       → replace geometry
 * DELETE /api/admin/bapenda/kabupaten/:id                → delete
 *
 * GET    /api/admin/bapenda/kecamatan?kd_wil=X           → list district_boundaries (filter by kab)
 * GET    /api/admin/bapenda/kecamatan/:id                → single + full geometry
 * POST   /api/admin/bapenda/kecamatan                    → create
 * PUT    /api/admin/bapenda/kecamatan/:id                → update metadata
 * PUT    /api/admin/bapenda/kecamatan/:id/geometry       → replace geometry
 * DELETE /api/admin/bapenda/kecamatan/:id                → delete
 *
 * GET    /api/admin/bapenda/desa?kd_kecamatan=X          → list village_boundaries (filter by kec)
 * GET    /api/admin/bapenda/desa/:id                     → single + full geometry
 * POST   /api/admin/bapenda/desa                         → create
 * PUT    /api/admin/bapenda/desa/:id                     → update metadata
 * PUT    /api/admin/bapenda/desa/:id/geometry            → replace geometry
 * DELETE /api/admin/bapenda/desa/:id                     → delete
 *
 * GET    /api/admin/bapenda/kabupaten/list-names         → {id, kd_wil, nama}[] for dropdowns
 * GET    /api/admin/bapenda/kecamatan/list-names?kd_wil  → {id, kd_kecamatan, nama}[] for dropdowns
 */

const express  = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('./db');
const logger   = require('./logger');
const { requireAuth } = require('./adminAuth');

const router = express.Router();
router.use(requireAuth);

// ─── validation helper ───────────────────────────────────────────────────────

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
  next();
};

// ─── geom update helper ──────────────────────────────────────────────────────

/** Update geom_postgis AND refresh geom_json cache */
async function updateGeom(client, table, id, geojsonStr) {
  await client.query(
    `UPDATE ${table}
     SET geom_postgis = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
         geom_json    = $1,
         updated_at   = NOW()
     WHERE id = $2`,
    [geojsonStr, id],
  );
}

// ═══════════════════════════════════════════════════════════════
//  KABUPATEN  (province_boundaries)
//  Fields: id, p3d_id (kd_wil), p3d (nama kabupaten)
// ═══════════════════════════════════════════════════════════════

// ── list-names dropdown helper ──────────────────────────────────
router.get('/kabupaten/list-names', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, p3d_id AS kd_wil, p3d AS nama
       FROM province_boundaries ORDER BY p3d`,
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /kabupaten → list ───────────────────────────────────────
router.get('/kabupaten', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, p3d_id AS kd_wil, p3d AS nama,
              created_at, updated_at
       FROM province_boundaries
       ORDER BY p3d`,
    );
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    logger.error('[BapendaAdmin] kabupaten list error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /kabupaten/:id → single + geometry ──────────────────────
router.get('/kabupaten/:id', [param('id').isInt({ min: 1 }), validate], async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, p3d_id AS kd_wil, p3d AS nama,
              ST_AsGeoJSON(geom_postgis)::json AS geometry,
              created_at, updated_at
       FROM province_boundaries WHERE id = $1`,
      [parseInt(req.params.id)],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /kabupaten → create ────────────────────────────────────
router.post(
  '/kabupaten',
  [
    body('kd_wil').notEmpty().withMessage('kd_wil (p3d_id) is required'),
    body('nama').notEmpty().withMessage('nama (p3d) is required'),
    body('geometry').isObject().withMessage('geometry (GeoJSON) is required'),
    body('geometry.type').isIn(['Polygon', 'MultiPolygon']).withMessage('geometry.type must be Polygon or MultiPolygon'),
    validate,
  ],
  async (req, res) => {
    const { kd_wil, nama, geometry } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const dup = await client.query('SELECT id FROM province_boundaries WHERE p3d_id = $1', [kd_wil]);
      if (dup.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: `kd_wil "${kd_wil}" sudah ada (id=${dup.rows[0].id})` });
      }
      const geomStr = JSON.stringify(geometry);
      const { rows } = await client.query(
        `INSERT INTO province_boundaries (p3d_id, p3d, geom_postgis, geom_json)
         VALUES ($1, $2, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)), $3)
         RETURNING id, p3d_id AS kd_wil, p3d AS nama`,
        [kd_wil, nama, geomStr],
      );
      await client.query('COMMIT');
      logger.info('[BapendaAdmin] kabupaten created', { id: rows[0].id, kd_wil });
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  },
);

// ── PUT /kabupaten/:id → update metadata ────────────────────────
router.put(
  '/kabupaten/:id',
  [param('id').isInt({ min: 1 }), body('kd_wil').optional().notEmpty(), body('nama').optional().notEmpty(), validate],
  async (req, res) => {
    const id = parseInt(req.params.id);
    const sets = []; const params = []; let p = 1;
    if (req.body.kd_wil !== undefined) { sets.push(`p3d_id = $${p++}`); params.push(req.body.kd_wil); }
    if (req.body.nama   !== undefined) { sets.push(`p3d    = $${p++}`); params.push(req.body.nama); }
    if (!sets.length) return res.status(400).json({ success: false, error: 'No fields to update' });
    params.push(id);
    try {
      const { rows } = await pool.query(
        `UPDATE province_boundaries SET ${sets.join(', ')} WHERE id = $${p}
         RETURNING id, p3d_id AS kd_wil, p3d AS nama, updated_at`,
        params,
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ── PUT /kabupaten/:id/geometry → replace geom ─────────────────
router.put(
  '/kabupaten/:id/geometry',
  [param('id').isInt({ min: 1 }), body('geometry').isObject(), body('geometry.type').isIn(['Polygon', 'MultiPolygon']), validate],
  async (req, res) => {
    const id = parseInt(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const geomStr = JSON.stringify(req.body.geometry);
      await updateGeom(client, 'province_boundaries', id, geomStr);
      const { rows } = await client.query(
        'SELECT id, p3d_id AS kd_wil, p3d AS nama, updated_at FROM province_boundaries WHERE id = $1',
        [id],
      );
      await client.query('COMMIT');
      if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  },
);

// ── DELETE /kabupaten/:id ───────────────────────────────────────
router.delete('/kabupaten/:id', [param('id').isInt({ min: 1 }), validate], async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      'DELETE FROM province_boundaries WHERE id = $1 RETURNING id, p3d_id AS kd_wil, p3d AS nama',
      [id],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, deleted: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  KECAMATAN  (district_boundaries)
//  Fields: id, district_id (kd_kecamatan), district (nama), p3d_id (kd_wil/ID_KAB), p3d (nm_kab), jmlh_kk
// ═══════════════════════════════════════════════════════════════

// ── list-names dropdown helper ──────────────────────────────────
router.get('/kecamatan/list-names', [query('kd_wil').optional().isString(), validate], async (req, res) => {
  try {
    const kd_wil = req.query.kd_wil || null;
    const { rows } = await pool.query(
      `SELECT id, district_id AS kd_kecamatan, district AS nama, p3d_id AS kd_wil
       FROM district_boundaries
       WHERE ($1::text IS NULL OR p3d_id = $1)
       ORDER BY district`,
      [kd_wil],
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /kecamatan?kd_wil=X → list ─────────────────────────────
router.get(
  '/kecamatan',
  [query('kd_wil').optional().isString(), validate],
  async (req, res) => {
    const kd_wil = req.query.kd_wil || null;
    try {
      const { rows } = await pool.query(
        `SELECT id, district_id AS kd_kecamatan, district AS nama,
                p3d_id AS kd_wil, p3d AS nm_kab, jmlh_kk,
                created_at, updated_at
         FROM district_boundaries
         WHERE ($1::text IS NULL OR p3d_id = $1)
         ORDER BY district`,
        [kd_wil],
      );
      res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
      logger.error('[BapendaAdmin] kecamatan list error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ── GET /kecamatan/:id → single + geometry ──────────────────────
router.get('/kecamatan/:id', [param('id').isInt({ min: 1 }), validate], async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, district_id AS kd_kecamatan, district AS nama,
              p3d_id AS kd_wil, p3d AS nm_kab, jmlh_kk,
              ST_AsGeoJSON(geom_postgis)::json AS geometry,
              created_at, updated_at
       FROM district_boundaries WHERE id = $1`,
      [parseInt(req.params.id)],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /kecamatan → create ────────────────────────────────────
router.post(
  '/kecamatan',
  [
    body('kd_kecamatan').notEmpty().withMessage('kd_kecamatan (district_id) is required'),
    body('nama').notEmpty().withMessage('nama (district) is required'),
    body('kd_wil').notEmpty().withMessage('kd_wil (p3d_id) is required'),
    body('nm_kab').optional().isString(),
    body('jmlh_kk').optional({ nullable: true }).isInt({ min: 0 }),
    body('geometry').isObject().withMessage('geometry (GeoJSON) is required'),
    body('geometry.type').isIn(['Polygon', 'MultiPolygon']),
    validate,
  ],
  async (req, res) => {
    const { kd_kecamatan, nama, kd_wil, nm_kab, jmlh_kk, geometry } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const geomStr = JSON.stringify(geometry);
      const { rows } = await client.query(
        `INSERT INTO district_boundaries
           (district_id, district, p3d_id, p3d, jmlh_kk, geom_postgis, geom_json)
         VALUES ($1, $2, $3, $4, $5,
                 ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)), $6)
         RETURNING id, district_id AS kd_kecamatan, district AS nama, p3d_id AS kd_wil`,
        [kd_kecamatan, nama, kd_wil, nm_kab || null, jmlh_kk || 0, geomStr],
      );
      await client.query('COMMIT');
      logger.info('[BapendaAdmin] kecamatan created', { id: rows[0].id, kd_kecamatan });
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  },
);

// ── PUT /kecamatan/:id → update metadata ───────────────────────
router.put(
  '/kecamatan/:id',
  [
    param('id').isInt({ min: 1 }),
    body('kd_kecamatan').optional().notEmpty(),
    body('nama').optional().notEmpty(),
    body('kd_wil').optional().notEmpty(),
    body('nm_kab').optional(),
    body('jmlh_kk').optional({ nullable: true }).isInt({ min: 0 }),
    validate,
  ],
  async (req, res) => {
    const id = parseInt(req.params.id);
    const map = { kd_kecamatan: 'district_id', nama: 'district', kd_wil: 'p3d_id', nm_kab: 'p3d', jmlh_kk: 'jmlh_kk' };
    const sets = []; const params = []; let p = 1;
    for (const [alias, col] of Object.entries(map)) {
      if (req.body[alias] !== undefined) { sets.push(`${col} = $${p++}`); params.push(req.body[alias]); }
    }
    if (!sets.length) return res.status(400).json({ success: false, error: 'No fields to update' });
    params.push(id);
    try {
      const { rows } = await pool.query(
        `UPDATE district_boundaries SET ${sets.join(', ')} WHERE id = $${p}
         RETURNING id, district_id AS kd_kecamatan, district AS nama, p3d_id AS kd_wil, jmlh_kk, updated_at`,
        params,
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ── PUT /kecamatan/:id/geometry ─────────────────────────────────
router.put(
  '/kecamatan/:id/geometry',
  [param('id').isInt({ min: 1 }), body('geometry').isObject(), body('geometry.type').isIn(['Polygon', 'MultiPolygon']), validate],
  async (req, res) => {
    const id = parseInt(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await updateGeom(client, 'district_boundaries', id, JSON.stringify(req.body.geometry));
      const { rows } = await client.query(
        'SELECT id, district_id AS kd_kecamatan, district AS nama, p3d_id AS kd_wil, updated_at FROM district_boundaries WHERE id = $1',
        [id],
      );
      await client.query('COMMIT');
      if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  },
);

// ── DELETE /kecamatan/:id ───────────────────────────────────────
router.delete('/kecamatan/:id', [param('id').isInt({ min: 1 }), validate], async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      'DELETE FROM district_boundaries WHERE id = $1 RETURNING id, district_id AS kd_kecamatan, district AS nama',
      [id],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, deleted: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  DESA  (village_boundaries)
//  Fields: id, unique_code, village (nama), district_id (kd_kecamatan), p3d (nm_kecamatan), p3d_id (kd_kec_p3d)
// ═══════════════════════════════════════════════════════════════

// ── GET /desa?kd_kecamatan=X → list ────────────────────────────
router.get(
  '/desa',
  [query('kd_kecamatan').optional().isString(), query('kode').optional().isString(), validate],
  async (req, res) => {
    const kode = req.query.kode || req.query.kd_kecamatan || null;
    try {
      const { rows } = await pool.query(
        `SELECT id, unique_code, village AS nama,
                district_id AS kd_kecamatan, p3d AS nm_kecamatan, p3d_id AS kd_kec_p3d,
                created_at, updated_at
         FROM village_boundaries
         WHERE ($1::text IS NULL OR district_id = $1)
         ORDER BY village`,
        [kode],
      );
      res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
      logger.error('[BapendaAdmin] desa list error', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ── GET /desa/:id → single + geometry ──────────────────────────
router.get('/desa/:id', [param('id').isInt({ min: 1 }), validate], async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, unique_code, village AS nama,
              district_id AS kd_kecamatan, p3d AS nm_kecamatan, p3d_id AS kd_kec_p3d,
              ST_AsGeoJSON(geom_postgis)::json AS geometry,
              created_at, updated_at
       FROM village_boundaries WHERE id = $1`,
      [parseInt(req.params.id)],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /desa → create ─────────────────────────────────────────
router.post(
  '/desa',
  [
    body('unique_code').notEmpty().withMessage('unique_code is required'),
    body('nama').notEmpty().withMessage('nama (village) is required'),
    body('kd_kecamatan').notEmpty().withMessage('kd_kecamatan (district_id) is required'),
    body('nm_kecamatan').optional().isString(),
    body('kd_kec_p3d').optional({ nullable: true }).isInt({ min: 0 }),
    body('geometry').isObject().withMessage('geometry (GeoJSON) is required'),
    body('geometry.type').isIn(['Polygon', 'MultiPolygon']),
    validate,
  ],
  async (req, res) => {
    const { unique_code, nama, kd_kecamatan, nm_kecamatan, kd_kec_p3d, geometry } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const geomStr = JSON.stringify(geometry);
      const { rows } = await client.query(
        `INSERT INTO village_boundaries
           (unique_code, village, district_id, p3d, p3d_id, geom_postgis, geom_json)
         VALUES ($1, $2, $3, $4, $5,
                 ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)), $6)
         RETURNING id, unique_code, village AS nama, district_id AS kd_kecamatan`,
        [unique_code, nama, kd_kecamatan, nm_kecamatan || null, kd_kec_p3d || null, geomStr],
      );
      await client.query('COMMIT');
      logger.info('[BapendaAdmin] desa created', { id: rows[0].id, unique_code });
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  },
);

// ── PUT /desa/:id → update metadata ────────────────────────────
router.put(
  '/desa/:id',
  [
    param('id').isInt({ min: 1 }),
    body('unique_code').optional().notEmpty(),
    body('nama').optional().notEmpty(),
    body('kd_kecamatan').optional().notEmpty(),
    body('nm_kecamatan').optional(),
    body('kd_kec_p3d').optional({ nullable: true }).isInt({ min: 0 }),
    validate,
  ],
  async (req, res) => {
    const id = parseInt(req.params.id);
    const map = { unique_code: 'unique_code', nama: 'village', kd_kecamatan: 'district_id', nm_kecamatan: 'p3d', kd_kec_p3d: 'p3d_id' };
    const sets = []; const params = []; let p = 1;
    for (const [alias, col] of Object.entries(map)) {
      if (req.body[alias] !== undefined) { sets.push(`${col} = $${p++}`); params.push(req.body[alias]); }
    }
    if (!sets.length) return res.status(400).json({ success: false, error: 'No fields to update' });
    params.push(id);
    try {
      const { rows } = await pool.query(
        `UPDATE village_boundaries SET ${sets.join(', ')} WHERE id = $${p}
         RETURNING id, unique_code, village AS nama, district_id AS kd_kecamatan, updated_at`,
        params,
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ── PUT /desa/:id/geometry ──────────────────────────────────────
router.put(
  '/desa/:id/geometry',
  [param('id').isInt({ min: 1 }), body('geometry').isObject(), body('geometry.type').isIn(['Polygon', 'MultiPolygon']), validate],
  async (req, res) => {
    const id = parseInt(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await updateGeom(client, 'village_boundaries', id, JSON.stringify(req.body.geometry));
      const { rows } = await client.query(
        'SELECT id, unique_code, village AS nama, district_id AS kd_kecamatan, updated_at FROM village_boundaries WHERE id = $1',
        [id],
      );
      await client.query('COMMIT');
      if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  },
);

// ── DELETE /desa/:id ────────────────────────────────────────────
router.delete('/desa/:id', [param('id').isInt({ min: 1 }), validate], async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      'DELETE FROM village_boundaries WHERE id = $1 RETURNING id, unique_code, village AS nama',
      [id],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, deleted: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
