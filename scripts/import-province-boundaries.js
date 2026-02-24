'use strict';
/**
 * Import province_boundaries from data/boundaries/jabar.json
 *
 * jabar.json is a GeoJSON FeatureCollection (Kabupaten/Kota layer).
 * Each feature maps to one row in province_boundaries:
 *   properties.OBJECTID → id (PK)
 *   properties.ID_KAB   → p3d_id  e.g. "10200"
 *   properties.KABKOT   → p3d     e.g. "Kab. Bogor (Cibinong)"
 *   feature.geometry    → geom_postgis (MultiPolygon, 4326)
 *
 * Usage:
 *   node scripts/import-province-boundaries.js          # real import
 *   DRY_RUN=1 node scripts/import-province-boundaries.js  # dry run
 */

const fs   = require('fs');
const path = require('path');

const GEO_FILE = path.join(__dirname, '..', 'data', 'boundaries', 'jabar.json');
const DRY_RUN  = process.env.DRY_RUN === '1';

console.log('=================================================================');
console.log('Import province_boundaries from jabar.json');
console.log(`File    : ${GEO_FILE}`);
console.log(`DRY_RUN : ${DRY_RUN}`);
console.log('=================================================================\n');

// ── load GeoJSON ───────────────────────────────────────────────────

if (!fs.existsSync(GEO_FILE)) {
  console.error(`ERROR: file not found: ${GEO_FILE}`);
  process.exit(1);
}

let fc;
try {
  fc = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8'));
} catch (e) {
  console.error(`ERROR: failed to parse ${GEO_FILE}: ${e.message}`);
  process.exit(1);
}

const features = fc.features || [];
console.log(`Features in GeoJSON: ${features.length}\n`);

// ── dry run preview ────────────────────────────────────────────────

if (DRY_RUN) {
  console.log('[DRY RUN] First 5 rows:\n');
  features.slice(0, 5).forEach((f, i) => {
    const p = f.properties || {};
    console.log(`  [${i + 1}] OBJECTID=${p.OBJECTID} | p3d_id=${p.ID_KAB} | p3d=${p.KABKOT} | geom_type=${f.geometry?.type}`);
  });
  console.log('\nDry run complete — no DB writes.');
  process.exit(0);
}

// ── real import ────────────────────────────────────────────────────

const { pool } = require('../src/db');

const UPSERT_SQL = `
INSERT INTO province_boundaries (id, p3d_id, p3d, geom_postgis, geom_json, updated_at)
VALUES (
  $1,
  $2,
  $3,
  ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
  $5,
  NOW()
)
ON CONFLICT (p3d_id) DO UPDATE SET
  id           = EXCLUDED.id,
  p3d          = EXCLUDED.p3d,
  geom_postgis = EXCLUDED.geom_postgis,
  geom_json    = EXCLUDED.geom_json,
  updated_at   = NOW()
`;

async function run() {
  let inserted = 0;
  let skipped  = 0;

  for (const feature of features) {
    const p     = feature.properties || {};
    const objId = parseInt(p.OBJECTID, 10);
    const p3dId = String(p.ID_KAB || '').trim();
    const p3d   = String(p.KABKOT  || '').trim();
    const geom  = feature.geometry;

    if (!p3dId || !geom) {
      console.warn(`  SKIP: OBJECTID=${objId} — missing p3d_id or geometry`);
      skipped++;
      continue;
    }

    const geomStr = JSON.stringify(geom);

    try {
      await pool.query(UPSERT_SQL, [objId, p3dId, p3d, geomStr, geomStr]);
      inserted++;
      process.stdout.write(`  OK  [${inserted}/${features.length}] ${p3dId} ${p3d}\r`);
    } catch (err) {
      console.error(`\n  ERROR: OBJECTID=${objId} p3d_id=${p3dId}: ${err.message}`);
      skipped++;
    }
  }

  process.stdout.write('\n');
  console.log(`\n=== Done: ${inserted} upserted, ${skipped} skipped ===`);

  await pool.end();
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
