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
      const tag = matchedViaNameOnly ? ` [name-only: GeoJSON kab="${rawKab}" DB p3d="${row.p3d}"]`
                : matchedViaFallback  ? ' [fallback-nospace]'
                : '';
      console.log(`  DRY: would update id=${row.id}  ${row.district} (${row.p3d_id})${tag}`);
      updated++;
      if (matchedViaFallback) updatedFallback++;
      if (matchedViaNameOnly) updatedNameOnly++;
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
  console.log(`    - exact match      : ${updated - updatedFallback - updatedNameOnly}`);
  console.log(`    - no-space fallback: ${updatedFallback}`);
  console.log(`    - name-only (P3D≠BPS kab): ${updatedNameOnly}`);
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
