/**
 * GeoJSON Routes
 *
 * GET  /api/geojson/kabupaten              → province_boundaries (kabupaten/kota)
 * GET  /api/geojson/kabupaten              → province_boundaries (kabupaten/kota)
 * GET  /api/geojson/kecamatan              → all district_boundaries
 * GET  /api/geojson/kecamatan?ids=a,b,c   → district_boundaries for specific p3d_ids
 * GET  /api/geojson/kecamatan?kd_wil=X    → district_boundaries by kabupaten p3d_id (e.g. ?kd_wil=12020)
 * GET  /api/geojson/desa?kode=<district_id> → village_boundaries by kecamatan code
 */

'use strict';

const express  = require('express');
const { pool } = require('./db');
const logger   = require('./logger');

const router = express.Router();

// ═══════════════════════════════════════════════════════
//  GET /api/geojson/desa?kode=<kd_kecamatan>
//  DB-backed query against village_boundaries table
// ═══════════════════════════════════════════════════════
router.get('/api/geojson/desa', async (req, res) => {
  const kode = (req.query.kode || req.query.kd_kecamatan || '').trim();

  const sql = `
    SELECT (
      json_build_object(
        'type',     'FeatureCollection',
        'features', COALESCE(
          json_agg(
            json_build_object(
              'type', 'Feature',
              'id',   id,
              'properties', json_build_object(
                'KODE',        district_id::text,
                'village',     village,
                'unique_code', unique_code,
                'p3d_id',      p3d_id,
                'p3d',         p3d
              ),
              'geometry', geom_json::json
            )
          ),
          '[]'::json
        )
      )
    )::text AS fc
    FROM village_boundaries
    WHERE ($1 = '' OR district_id::text = $1)
  `;

  try {
    const { rows } = await pool.query(sql, [kode]);
    res.set('Content-Type', 'application/json');
    res.send(rows[0]?.fc || '{"type":"FeatureCollection","features":[]}');
  } catch (err) {
    logger.error('GET /api/geojson/desa error', { kode, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  GET /api/geojson/kabupaten
//  Queries province_boundaries table.
//  Optional filter: ?p3d_id=10200
// ═══════════════════════════════════════════════════════
router.get('/api/geojson/kabupaten', async (req, res) => {
  const p3dId = (req.query.p3d_id || req.p3dId || '').toString().trim() || null;

  const sql = `
    SELECT json_build_object(
      'type',        'FeatureCollection',
      'name',        'Jabar_By_Kab',
      'crs', json_build_object(
        'type',       'name',
        'properties', json_build_object('name','urn:ogc:def:crs:OGC:1.3:CRS84')
      ),
      'features', COALESCE(
        json_agg(
          json_build_object(
            'type',       'Feature',
            'properties', json_build_object(
              'OBJECTID', id,
              'PROVINSI', 'JAWA BARAT',
              'PROVNO',   '32',
              'KABKOTNO', RIGHT(p3d_id, 2),
              'KABKOT',   p3d,
              'ID_KAB',   p3d_id::text
            ),
            'geometry', ST_AsGeoJSON(geom_postgis)::json
          )
        ),
        '[]'::json
      )
    ) AS fc
    FROM province_boundaries
    WHERE ($1::text IS NULL OR p3d_id = $1::text)
  `;

  try {
    const { rows } = await pool.query(sql, [p3dId]);
    const fc = rows[0]?.fc;
    if (!fc) return res.status(404).json({ error: 'No province data found' });
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(fc));
  } catch (err) {
    logger.error('GET /api/geojson/kabupaten error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  GET /api/geojson/kecamatan
//  No param    → all districts
//  ?ids=a,b    → districts for specific p3d_ids (comma-separated)
//  ?kd_wil=X   → districts by kabupaten p3d_id (e.g. ?kd_wil=12020)
// ═══════════════════════════════════════════════════════
router.get('/api/geojson/kecamatan', async (req, res) => {
  const kdWil   = (req.query.kd_wil || '').trim();
  const idsParam = (req.query.ids || '').trim();
  const ids = idsParam ? idsParam.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)) : [];

  // ?kd_wil=X → single kabupaten filter (same as /:p3d_id)
  if (kdWil) {
    if (!/^\d+$/.test(kdWil)) return res.status(400).json({ error: 'kd_wil must be numeric' });

    const sql = `
      SELECT json_build_object(
        'type',        'FeatureCollection',
        'name',        'Jabar_By_Kec',
        'crs', json_build_object(
          'type',       'name',
          'properties', json_build_object('name','urn:ogc:def:crs:OGC:1.3:CRS84')
        ),
        'features', COALESCE(
          json_agg(
            json_build_object(
              'type',       'Feature',
              'properties', json_build_object(
                'OBJECTID',       id,
                'PROVINSI',       'JAWA BARAT',
                'PROVNO',         '32',
                'kd_kecamatan',   district_id,
                'nm_kecamatan',   district,
                'ID_KAB',         p3d_id
              ),
              'geometry', ST_AsGeoJSON(geom_postgis)::json
            )
          ),
          '[]'::json
        )
      ) AS fc
      FROM district_boundaries
      WHERE p3d_id = $1
    `;

    try {
      const { rows } = await pool.query(sql, [kdWil]);
      const fc = rows[0]?.fc;
      if (!fc) return res.status(404).json({ error: `No kecamatan for kd_wil=${kdWil}` });
      res.set('Cache-Control', 'public, max-age=300');
      res.set('Content-Type', 'application/json; charset=utf-8');
      return res.send(JSON.stringify(fc));
    } catch (err) {
      logger.error('GET /api/geojson/kecamatan (kd_wil) error', { kdWil, error: err.message });
      return res.status(500).json({ error: err.message });
    }
  }

  const sql = `
    SELECT json_build_object(
      'type',        'FeatureCollection',
      'name',        'Jabar_By_Kec',
      'crs', json_build_object(
        'type',       'name',
        'properties', json_build_object('name','urn:ogc:def:crs:OGC:1.3:CRS84')
      ),
      'features', COALESCE(
        json_agg(
          json_build_object(
            'type',       'Feature',
            'properties', json_build_object(
              'OBJECTID',       id,
              'PROVINSI',       'JAWA BARAT',
              'PROVNO',         '32',
              'kd_kecamatan',   district_id,
              'nm_kecamatan',   district,
              'ID_KAB',         p3d_id
            ),
            'geometry', ST_AsGeoJSON(geom_postgis)::json
          )
        ),
        '[]'::json
      )
    ) AS fc
    FROM district_boundaries
    WHERE ($1::text[] IS NULL OR p3d_id = ANY($1::text[]))
  `;

  try {
    const param = ids.length > 0 ? ids : null;
    const { rows } = await pool.query(sql, [param]);
    const fc = rows[0]?.fc;
    if (!fc) return res.status(404).json({ error: 'No kecamatan data found' });
    res.set('Cache-Control', 'public, max-age=300');
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(fc));
  } catch (err) {
    logger.error('GET /api/geojson/kecamatan (bulk) error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
