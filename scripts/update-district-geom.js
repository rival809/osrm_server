/**
 * update-district-geom.js
 * ────────────────────────────────────────────────────────────────────────────
 * Updates ONLY the geometry (geom_postgis + geom_json) of existing rows in
 * district_boundaries using a new GeoJSON file.
 *
 * DOES NOT touch: district_id, district, p3d_id, p3d, city_id, jmlh_kk
 *
 * Matching strategy:
 *   GeoJSON property  KECAMATAN  →  DB column  district   (normalised UPPER TRIM)
 *   GeoJSON property  KABKOT     →  DB column  p3d        (strip "KABUPATEN "/"KOTA " prefix)
 *
 * Usage:
 *   node scripts/update-district-geom.js
 *   DRY_RUN=1 node scripts/update-district-geom.js
 *   GEOJSON=data/boundaries/MyFile.geojson node scripts/update-district-geom.js
 *
 *   Inside Docker:
 *   docker exec osrm-tile-service node scripts/update-district-geom.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ── config ───────────────────────────────────────────────────────────────────

const GEOJSON_FILE = path.join(
  __dirname, '..',
  process.env.GEOJSON || 'data/boundaries/Jabar_By_Kec.geojson'
);

const DRY_RUN = process.env.DRY_RUN === '1';

const pool = new Pool({
  host:     process.env.PGHOST     || 'postgres',
  port:     parseInt(process.env.PGPORT)  || 5432,
  database: process.env.PGDATABASE || 'nominatim',
  user:     process.env.PGUSER     || 'nominatim',
  password: process.env.PGPASSWORD || 'nominatim123',
  connectionTimeoutMillis: 15000,
  statement_timeout: 300000,
});

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise kecamatan name: UPPER + collapse internal spaces + trim.
 */
function normName(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * Normalise kecamatan name with all spaces removed.
 * Used as fallback when exact-space match fails.
 * e.g. "BOJONG GEDE" → "BOJONGGEDE", "SUKMA JAYA" → "SUKMAJAYA"
 */
function normNameNoSpace(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, '').trim();
}

/**
 * Normalise kabupaten/kota name for comparison.
 * DB stores "KABUPATEN BOGOR" or "KOTA BANDUNG".
 * GeoJSON stores "BOGOR" or "BANDUNG" (KABKOT field).
 * Strip prefix and normalise.
 */
function normKab(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/^(KABUPATEN|KAB\.?|KOTA|KOTA ADMINISTRASI)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(70));
  console.log('update-district-geom.js');
  console.log(`GeoJSON : ${GEOJSON_FILE}`);
  console.log(`Dry-run : ${DRY_RUN}`);
  console.log('='.repeat(70));

  // 1. Read GeoJSON
  if (!fs.existsSync(GEOJSON_FILE)) {
    console.error(`ERROR: GeoJSON file not found: ${GEOJSON_FILE}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(GEOJSON_FILE, 'utf8');
  const geojson = JSON.parse(raw);
  const features = geojson.features || [];
  console.log(`Loaded ${features.length} features from GeoJSON.\n`);

  // 1b. Build BPS kab code (int) → p3d_id (string) mapping from kec/*.json files.
  //     Each file data/boundaries/kec/<p3d_id>.json has items with field
  //     kd_pos_kd_kab_kota = BPS kab code string e.g. "3203".
  //     This lets us resolve ambiguous name-only matches using ID_KAB from GeoJSON.
  const KEC_DIR = path.join(__dirname, '..', 'data', 'boundaries', 'kec');
  const bpsKabToP3d = new Map(); // BPS kab int → p3d_id string
  if (fs.existsSync(KEC_DIR)) {
    for (const fname of fs.readdirSync(KEC_DIR)) {
      if (!fname.endsWith('.json')) continue;
      const p3dId = fname.replace('.json', '');
      try {
        const content = JSON.parse(fs.readFileSync(path.join(KEC_DIR, fname), 'utf8'));
        const items = Array.isArray(content) ? content : (content.data || content.results || []);
        if (items.length > 0) {
          const bpsCode = items[0].kd_pos_kd_kab_kota;
          if (bpsCode) bpsKabToP3d.set(parseInt(bpsCode, 10), p3dId);
        }
      } catch (_) { /* skip malformed files */ }
    }
    console.log(`BPS kab→p3d_id map: ${bpsKabToP3d.size} entries from kec/*.json\n`);
  } else {
    console.warn(`WARN: kec/ directory not found at ${KEC_DIR} — ambiguous matches cannot be auto-resolved\n`);
  }

  // 2. Build a lookup map from DB: (normName, normKab) → row
  //    We do this once to avoid N×queryDB.
  console.log('Loading district_boundaries from DB...');
  const client = await pool.connect();

  let dbRows;
  try {
    const res = await client.query(
      'SELECT id, p3d_id, district_id, district, p3d FROM district_boundaries'
    );
    dbRows = res.rows;
  } finally {
    client.release();
  }
  console.log(`DB has ${dbRows.length} rows.\n`);

  // Build primary lookup: normName+'|'+normKab → [rows]
  const lookup = new Map();
  // Build secondary lookup: noSpaceName+'|'+normKab → [rows]
  const lookupNoSpace = new Map();
  // Build name-only lookup (no spaces, no kab) for diagnostics
  // Key: normNameNoSpace → [rows]  — tells us what p3d the DB has for a given name
  const lookupNameOnly = new Map();
  for (const row of dbRows) {
    const key   = normName(row.district)        + '|' + normKab(row.p3d);
    const keyNS = normNameNoSpace(row.district)  + '|' + normKab(row.p3d);
    const keyN  = normNameNoSpace(row.district);
    if (!lookup.has(key))           lookup.set(key, []);
    if (!lookupNoSpace.has(keyNS))  lookupNoSpace.set(keyNS, []);
    if (!lookupNameOnly.has(keyN))  lookupNameOnly.set(keyN, []);
    lookup.get(key).push(row);
    lookupNoSpace.get(keyNS).push(row);
    lookupNameOnly.get(keyN).push(row);
  }

  // 3. Process each GeoJSON feature
  let updated         = 0;
  let updatedFallback = 0;  // via no-space name fallback
  let updatedNameOnly = 0;  // via name-only fallback (kab skipped — P3D vs BPS mismatch)
  let updatedKabBps   = 0;  // ambiguous resolved via BPS ID_KAB→p3d_id
  let skipped    = 0;
  let notFound   = 0;
  let ambiguous  = 0;

  const notFoundList  = [];  // { rawName, rawKab, key }
  const ambiguousList = [];

  for (const feature of features) {
    const props = feature.properties || {};
    const rawName = props.KECAMATAN || '';
    const rawKab  = props.KABKOT    || '';

    const key = normName(rawName) + '|' + normKab(rawKab);
    let matches = lookup.get(key) || [];
    let matchedViaFallback = false;
    let matchedViaNameOnly = false;
    let matchedViaKabBps   = false;  // ambiguous resolved via BPS ID_KAB

    if (matches.length === 0) {
      // Fallback 1: try with all spaces removed from name (same kab)
      // e.g. "BOJONG GEDE" → "BOJONGGEDE", "TAJUR HALANG" → "TAJURHALANG"
      const keyNS = normNameNoSpace(rawName) + '|' + normKab(rawKab);
      const fallback = lookupNoSpace.get(keyNS) || [];
      if (fallback.length > 0) {
        matches = fallback;
        matchedViaFallback = true;
      }
    }

    if (matches.length === 0) {
      // Fallback 2: name-only match (ignore kab), for cases where P3D and BPS
      // assign the same kecamatan to different kabupatens.
      // e.g. "BATUJAJAR" in GeoJSON=BANDUNG BARAT but DB=KABUPATEN BANDUNG.
      // lookupNameOnly keyed by normNameNoSpace(district), so use same for lookup.
      const keyNNS = normNameNoSpace(rawName);
      const nameOnly = lookupNameOnly.get(keyNNS) || [];
      if (nameOnly.length === 1) {
        matches = nameOnly;
        matchedViaNameOnly = true;
      } else if (nameOnly.length > 1) {
        // Multiple DB rows share this name — hand off to ambiguous block below
        matches = nameOnly;
      }
    }

    if (matches.length === 0) {
      notFound++;
      notFoundList.push({ rawName, rawKab, key });
      continue;
    }

    if (matches.length > 1) {
      // Try to resolve ambiguity using BPS ID_KAB from GeoJSON → p3d_id mapping.
      const bpsKab = Math.round(feature.properties.ID_KAB || 0);
      const p3dIdFromBps = bpsKabToP3d.get(bpsKab);
      if (p3dIdFromBps) {
        const narrowed = matches.filter(r => r.p3d_id === p3dIdFromBps);
        if (narrowed.length === 1) {
          matches = narrowed;
          matchedViaKabBps = true;
        } else if (narrowed.length > 1) {
          // Still ambiguous within same kab — fall through to ambiguous block
          matches = narrowed;
        }
        // narrowed.length === 0: BPS kab not in DB at all, leave matches as-is → ambiguous
      }
    }

    if (matches.length > 1) {
      ambiguous++;
      ambiguousList.push(
        `  AMBIGUOUS : "${rawName}" in "${rawKab}" → ${matches.length} rows: ` +
        matches.map(r => `id=${r.id} p3d_id=${r.p3d_id} district_id=${r.district_id}`).join(', ')
      );
      continue;
    }

    const row  = matches[0];
    const geom = feature.geometry;

    if (!geom) {
      console.warn(`  WARN: null geometry for "${rawName}" — skipping`);
      skipped++;
      continue;
    }

    // Ensure MultiPolygon
    let multiGeom = geom;
    if (geom.type === 'Polygon') {
      multiGeom = { type: 'MultiPolygon', coordinates: [geom.coordinates] };
    } else if (geom.type !== 'MultiPolygon') {
      console.warn(`  WARN: unexpected geometry type "${geom.type}" for "${rawName}" — skipping`);
      skipped++;
      continue;
    }

    const geomJson  = JSON.stringify(multiGeom);
    const geomWkt   = `ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)`;

    if (DRY_RUN) {
      const tag = matchedViaKabBps   ? ` [kab-bps: ID_KAB=${feature.properties.ID_KAB}→p3d_id=${row.p3d_id}]`
                : matchedViaNameOnly ? ` [name-only: GeoJSON kab="${rawKab}" DB p3d="${row.p3d}"]`
                : matchedViaFallback  ? ' [fallback-nospace]'
                : '';
      console.log(`  DRY: would update id=${row.id}  ${row.district} (${row.p3d_id})${tag}`);
      updated++;
      if (matchedViaFallback) updatedFallback++;
      if (matchedViaNameOnly) updatedNameOnly++;
      if (matchedViaKabBps)   updatedKabBps++;
      continue;
    }

    const updateClient = await pool.connect();
    try {
      await updateClient.query(
        `UPDATE district_boundaries
            SET geom_postgis = ${geomWkt},
                geom_json    = $2,
                updated_at   = NOW()
          WHERE id = $3`,
        [geomJson, geomJson, row.id]
      );
      updated++;
      if (matchedViaFallback) updatedFallback++;
      if (matchedViaNameOnly) updatedNameOnly++;
      if (matchedViaKabBps)   updatedKabBps++;
      if (updated % 50 === 0) {
        process.stdout.write(`  updated ${updated}/${features.length}\r`);
      }
    } catch (err) {
      console.error(`  ERROR updating id=${row.id} "${row.district}": ${err.message}`);
      skipped++;
    } finally {
      updateClient.release();
    }
  }

  // 4. Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Features in GeoJSON : ${features.length}`);
  console.log(`  Updated             : ${updated}`);
  console.log(`    - exact match            : ${updated - updatedFallback - updatedNameOnly - updatedKabBps}`);
  console.log(`    - no-space fallback       : ${updatedFallback}`);
  console.log(`    - name-only (P3D≠BPS kab) : ${updatedNameOnly}`);
  console.log(`    - ambiguous→BPS kab res.  : ${updatedKabBps}`);
  console.log(`  Not found in DB     : ${notFound}`);
  console.log(`  Ambiguous (>1 match): ${ambiguous}`);
  console.log(`  Skipped (other)     : ${skipped}`);

  if (notFoundList.length) {
    console.log('\nNot found (\u201cNAME NOT IN DB\u201d = truly absent; otherwise shows DB kab mismatch):');
    for (const { rawName, rawKab, key } of notFoundList) {
      const dbMatches = lookupNameOnly.get(normNameNoSpace(rawName)) || [];
      let diag;
      if (dbMatches.length === 0) {
        diag = 'NAME NOT IN DB AT ALL';
      } else {
        diag = 'DB has p3d: ' + [...new Set(dbMatches.map(r => `"${r.p3d}"` ))].join(', ');
      }
      console.log(`  NOT FOUND : "${rawName}" in "${rawKab}"  →  ${diag}`);
    }
  }
  if (ambiguousList.length) {
    console.log('\nAmbiguous:');
    ambiguousList.forEach(l => console.log(l));
  }

  console.log('\nDone.');
  await pool.end();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
