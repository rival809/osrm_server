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
 * Manual disambiguation overrides for cases where both BPS kab and kab-name
 * filters fail to resolve ambiguity. Key: "NORMNAME|NORMKAB", value: p3d_id to pick.
 * Also used to force correct p3d_id when BPS kab mapping is incorrect.
 */
const AMBIGUOUS_OVERRIDE = {
  'CIDAHU|SUKABUMI':       '10500',
  'SUKASARI|SUMEDANG':     '12500',
  'SUKASARI|PURWAKARTA':   '11100',
  // BANDUNG BARAT (GeoJSON) → p3d_id=12300 (KABUPATEN BANDUNG BARAT in DB)
  'BATUJAJAR|BANDUNG BARAT':    '12300',
  'CIHAMPELAS|BANDUNG BARAT':   '12300',
  'CILILIN|BANDUNG BARAT':      '12300',
  'LEMBANG|BANDUNG BARAT':      '12300',
  'SINDANGKERTA|BANDUNG BARAT': '12300',
};

/**
 * Manual alias map: GeoJSON KECAMATAN name → DB district name.
 * Used for known spelling divergences between the two datasets.
 * Key: UPPER TRIM of GeoJSON name. Value: UPPER TRIM of DB name.
 */
const NAME_ALIAS = {
  'BLUBUR LIMBANGAN': 'BALUBUR LIMBANGAN',
  'CINGAMBUL':        'CIGAMBUL',
  'KANDANGHAUR':      'KADANGHAUR',
  'KELAPA NUNGGAL':   'KLAPANUNGGAL',
  'PAGADEN BARAT':    'PEGADEN BARAT',
  'PAGERAGEUNG':      'PAGEURAGEUNG',
  'PELABUHAN RATU':   'PALABUHANRATU',
  'TALAGASARI':       'TELAGASARI',
  'TANAH SEREAL':     'TANAH SAREAL',
  'WARUDOYONG':       'WARUNGDOYONG',
};

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
  let updatedFallback = 0;
  let updatedNameOnly = 0;
  let updatedKabBps   = 0;
  let updatedAlias    = 0;
  let updatedKabName  = 0;
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
    let matchedViaAlias    = false;
    let matchedViaNameOnly = false;
    let matchedViaKabBps   = false;
    let matchedViaKabName  = false;

    // ── Early override: force p3d_id before any fallback logic runs.
    // Catches cases where BPS kab resolution or name-only would pick the wrong row.
    {
      const overrideKey = normNameNoSpace(rawName) + '|' + normKab(rawKab);
      const overrideP3d = AMBIGUOUS_OVERRIDE[overrideKey];
      if (overrideP3d) {
        const forced = dbRows.filter(r => r.p3d_id === overrideP3d &&
          normNameNoSpace(r.district) === normNameNoSpace(rawName));
        if (forced.length === 1) {
          matches = forced;
          matchedViaKabName = true; // reuse counter for "manually overridden"
        }
      }
    }

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
      // Fallback 2: name-only match (ignore kab), ONLY when the GeoJSON kab and
      // every candidate DB row's kab are genuinely different kabupaten — i.e. the
      // normalised kab names do not match. This handles P3D vs BPS assigning
      // kecamatan to different kabupatens (e.g. GeoJSON="BANDUNG BARAT" vs
      // DB="KABUPATEN BANDUNG" — different kabs despite sharing the word "BANDUNG").
      const keyNNS  = normNameNoSpace(rawName);
      const nameOnly = lookupNameOnly.get(keyNNS) || [];
      if (nameOnly.length >= 1) {
        const geoKabNorm = normKab(rawKab);
        const genuinelyCrossKab = nameOnly.every(r => normKab(r.p3d) !== geoKabNorm);
        if (genuinelyCrossKab) {
          if (nameOnly.length === 1) {
            matches = nameOnly;
            matchedViaNameOnly = true;
          } else {
            matches = nameOnly; // multiple candidates — pass to ambiguous/BPS resolver
          }
        }
      }
    }

    if (matches.length === 0) {
      // Fallback 3: alias map for known spelling divergences between GeoJSON and DB.
      const aliasName = NAME_ALIAS[normName(rawName)];
      if (aliasName) {
        const keyAlias   = aliasName + '|' + normKab(rawKab);
        const keyAliasNS = normNameNoSpace(aliasName) + '|' + normKab(rawKab);
        const aliasByKab = lookup.get(keyAlias) || lookupNoSpace.get(keyAliasNS) || [];
        if (aliasByKab.length === 1) {
          matches = aliasByKab;
          matchedViaAlias = true;
        } else if (aliasByKab.length === 0) {
          // Kab also differs — try name-only with alias
          const aliasByName = lookupNameOnly.get(normNameNoSpace(aliasName)) || [];
          if (aliasByName.length === 1) {
            matches = aliasByName;
            matchedViaAlias = true;
          } else if (aliasByName.length > 1) {
            matches = aliasByName; // hand off to ambiguous/BPS resolver below
          }
        }
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
          matches = narrowed;
        }
      }
    }

    if (matches.length > 1) {
      // Last resort: filter by kab name match (normKab(row.p3d) === normKab(rawKab)).
      // Handles cases where BPS→p3d_id map has no entry (kec/*.json missing) but the
      // ambiguous candidates include the correct kab by name. e.g. CIDAHU in SUKABUMI.
      const narrowed = matches.filter(r => normKab(r.p3d) === normKab(rawKab));
      if (narrowed.length === 1) {
        matches = narrowed;
        matchedViaKabName = true;
      } else if (narrowed.length > 1) {
        matches = narrowed;
      }
    }

    if (matches.length > 1) {
      // Final resort: manual override map for stubborn ambiguous cases.
      const overrideKey = normNameNoSpace(rawName) + '|' + normKab(rawKab);
      const overrideP3d = AMBIGUOUS_OVERRIDE[overrideKey];
      if (overrideP3d) {
        const narrowed = matches.filter(r => r.p3d_id === overrideP3d);
        if (narrowed.length === 1) {
          matches = narrowed;
          matchedViaKabName = true; // reuse counter for "manually overridden"
        }
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
                : matchedViaKabName  ? ` [kab-name: "${rawKab}"→p3d="${row.p3d}"]`
                : matchedViaAlias    ? ` [alias: "${rawName}"→"${row.district}"]`
                : matchedViaNameOnly ? ` [name-only: GeoJSON kab="${rawKab}" DB p3d="${row.p3d}"]`
                : matchedViaFallback  ? ' [fallback-nospace]'
                : '';
      console.log(`  DRY: would update id=${row.id}  ${row.district} (${row.p3d_id})${tag}`);
      updated++;
      if (matchedViaFallback) updatedFallback++;
      if (matchedViaNameOnly) updatedNameOnly++;
      if (matchedViaKabBps)   updatedKabBps++;
      if (matchedViaAlias)    updatedAlias++;
      if (matchedViaKabName)  updatedKabName++;
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
      if (matchedViaAlias)    updatedAlias++;
      if (matchedViaKabName)  updatedKabName++;
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
  const exact = updated - updatedFallback - updatedNameOnly - updatedKabBps - updatedAlias - updatedKabName;
  console.log(`    - exact match            : ${exact}`);
  console.log(`    - no-space fallback       : ${updatedFallback}`);
  console.log(`    - alias (name typo)       : ${updatedAlias}`);
  console.log(`    - name-only (P3D≠BPS kab) : ${updatedNameOnly}`);
  console.log(`    - ambiguous→BPS kab       : ${updatedKabBps}`);
  console.log(`    - ambiguous→kab name      : ${updatedKabName}`);
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
