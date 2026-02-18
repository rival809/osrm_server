/**
 * Legacy GeoJSON Routes
 *
 * These routes mirror the Go/Gin project endpoints so that any client
 * that was hitting the old backend works identically against this service.
 *
 * GET  /jabar                        → province_boundaries DB query (kabupaten/kota)
 * GET  /kecamatan/:kodeKab           → kecamatan by kabupaten code (DB query)
 * GET  /kelurahan/:kodeKab           → Kelurahan/{kodeKab}_kelurahan.geojson
 * GET  /desa_fix?kode=<kd_kecamatan> → filter desa.geojson in-memory
 * GET  /desa?kode=<kd_kecamatan>     → desa from village_boundaries DB table
 *
 * Also exposes the same data through the /api/geojson prefix:
 * GET  /api/geojson/kabupaten        → same as /jabar (province_boundaries DB)
 * GET  /api/geojson/kecamatan/:p3d_id → same as /kecamatan/:kodeKab
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { pool } = require('./db');
const logger   = require('./logger');

const router = express.Router();

const BOUNDARIES_DIR = path.join(__dirname, '..', 'data', 'boundaries');

// ── helper ──────────────────────────────────────────────────

function sendFile(res, filePath, cacheSeconds = 3600) {
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'file not found' });
  }
  res.set('Cache-Control', `public, max-age=${cacheSeconds}`);
  res.sendFile(filePath);
}

// ═══════════════════════════════════════════════════════
//  GET /jabar
//  Mirrors the legacy Go/Gin GetMapJabar handler.
//  Queries province_boundaries table.
//  Optional filter: ?p3d_id=10200  (or set via JWT claim in future)
// ═══════════════════════════════════════════════════════
router.get('/jabar', async (req, res) => {
  // p3d_id filter: support query param (JWT claim can be added later)
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
    logger.error('GET /jabar error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  GET /kecamatan/:kodeKab
//  kodeKab = p3d_id string, e.g. "10200"
//
//  Queries district_boundaries table WHERE p3d_id = $1 (VARCHAR match).
//  Returns a FeatureCollection matching the old Go project output format:
//    properties: { OBJECTID, PROVINSI, PROVNO, kd_kecamatan, nm_kecamatan, ID_KAB }
// ═══════════════════════════════════════════════════════
router.get('/kecamatan/:kodeKab', async (req, res) => {
  const { kodeKab } = req.params;

  if (!/^\d+$/.test(kodeKab)) {
    return res.status(400).json({ error: 'kodeKab must be numeric' });
  }

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
    const { rows } = await pool.query(sql, [kodeKab]);
    const fc = rows[0]?.fc;
    if (!fc) return res.status(404).json({ error: `No kecamatan found for kodeKab=${kodeKab}` });
    res.set('Cache-Control', 'public, max-age=300');
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(fc));
  } catch (err) {
    logger.error('GET /kecamatan/:kodeKab error', { kodeKab, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  GET /kelurahan/:kodeKab
//  Reads data/boundaries/Kelurahan/{kodeKab}_kelurahan.geojson
// ═══════════════════════════════════════════════════════
router.get('/kelurahan/:kodeKab', (req, res) => {
  const { kodeKab } = req.params;
  const filePath = path.join(BOUNDARIES_DIR, 'Kelurahan', `${kodeKab}_kelurahan.geojson`);
  sendFile(res, filePath);
});

// ═══════════════════════════════════════════════════════
//  GET /desa_fix?kode=<kd_kecamatan>
//  File-based filter on desa.geojson (legacy in-memory approach)
// ═══════════════════════════════════════════════════════
router.get('/desa_fix', (req, res) => {
  const kode = (req.query.kode || req.query.kec || '').trim();

  const desaPath = path.join(BOUNDARIES_DIR, 'Desa', 'desa.geojson');
  if (!fs.existsSync(desaPath)) {
    return res.status(404).json({ error: 'desa.geojson not found' });
  }

  let fc;
  try {
    fc = JSON.parse(fs.readFileSync(desaPath, 'utf8'));
  } catch (err) {
    return res.status(500).json({ error: 'bad geojson' });
  }

  if (!kode) {
    res.set('Content-Type', 'application/json');
    return res.send(JSON.stringify(fc));
  }

  const filtered = {
    type: fc.type,
    features: (fc.features || []).filter(f => {
      const props = f.properties || {};
      const kodeProp = String(props.KODE ?? props.kode ?? '').trim();
      return kodeProp === kode;
    }),
  };

  res.set('Content-Type', 'application/json');
  res.send(JSON.stringify(filtered));
});

// ═══════════════════════════════════════════════════════
//  GET /desa?kode=<kd_kecamatan>
//  DB-backed query against village_boundaries table
//  (mirrors the Go legacy /desa endpoint)
// ═══════════════════════════════════════════════════════
router.get('/desa', async (req, res) => {
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
    logger.error('GET /desa error', { kode, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  /api/geojson/* aliases (same data, /api prefix)
// ═══════════════════════════════════════════════════════

/** GET /api/geojson/kabupaten  →  same as /jabar (province_boundaries DB) */
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

/** GET /api/geojson/kecamatan/:p3d_id  →  same as /kecamatan/:kodeKab */
router.get('/api/geojson/kecamatan/:p3d_id', async (req, res) => {
  const kodeKab = req.params.p3d_id;
  if (!/^\d+$/.test(kodeKab)) return res.status(400).json({ error: 'p3d_id must be numeric' });

  // Forward to the /kecamatan/:kodeKab handler logic (query DB)
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
    const { rows } = await pool.query(sql, [kodeKab]);
    const fc = rows[0]?.fc;
    if (!fc) return res.status(404).json({ error: `No kecamatan for p3d_id=${kodeKab}` });
    res.set('Cache-Control', 'public, max-age=300');
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(fc));
  } catch (err) {
    logger.error('GET /api/geojson/kecamatan error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
