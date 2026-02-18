/**
 * import-district-boundaries.js
 * ──────────────────────────────
 * Imports kecamatan (district) boundaries into the `district_boundaries` table.
 *
 * SOURCE OF TRUTH:
 *   data/boundaries/data_lama/export-district_boundaries-20251027-63316.csv
 *
 *   CSV columns (in order):
 *     city_id, district_id, id, p3d_id, province, district, geom.type, geom.coordinates, jmlh_kk
 *
 *   The CSV is a DIRECT export from the old Go/Gin project's PostgreSQL database.
 *   district_id and p3d_id are 5-digit custom IDs (NOT BPS/Kemendagri codes):
 *     district_id  e.g. "10103"  — individual kecamatan ID
 *     p3d_id       e.g. "10200"  — kabupaten ID (used in API /kecamatan/:kodeKab)
 *     province     e.g. "KABUPATEN BOGOR"  — stored as p3d in DB
 *     district     e.g. "GUNUNG SINDUR"    — kecamatan name
 *
 * Usage:
 *   node scripts/import-district-boundaries.js
 *   DRY_RUN=1 node scripts/import-district-boundaries.js
 *   docker exec osrm-tile-service node scripts/import-district-boundaries.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ── config ────────────────────────────────────────────────────────────────────

const CSV_FILE = path.join(
  __dirname, '..', 'data', 'boundaries', 'data_lama',
  'export-district_boundaries-20251027-63316.csv'
);

const DRY_RUN = process.env.DRY_RUN === '1';

const pool = new Pool({
  host:     process.env.PGHOST     || 'postgres',
  port:     parseInt(process.env.PGPORT)  || 5432,
  database: process.env.PGDATABASE || 'nominatim',
  user:     process.env.PGUSER     || 'nominatim',
  password: process.env.PGPASSWORD || 'nominatim123',
  connectionTimeoutMillis: 15000,
  statement_timeout: 120000,
});

// ── CSV parser ────────────────────────────────────────────────────────────────
// Row format: ,"10103",1,"10200","KABUPATEN BOGOR","GUNUNG SINDUR","MultiPolygon","[[...]]","0"
// Fields (mixed quoted/unquoted):
//   [0] city_id       — unquoted blank → null
//   [1] district_id   — quoted "10103"
//   [2] id            — unquoted integer 1
//   [3] p3d_id        — quoted "10200"
//   [4] province      — quoted "KABUPATEN BOGOR"
//   [5] district      — quoted "GUNUNG SINDUR"
//   [6] geom.type     — quoted "MultiPolygon"  (always MultiPolygon or Polygon)
//   [7] geom.coords   — quoted "[[...]]"  (contains commas!)
//   [8] jmlh_kk       — quoted "0"
//
// Strategy: anchor on ,"MultiPolygon" or ,"Polygon" to split prefix from geometry.

function parseCSVLine(l) {
  const trimmed = l.trim();
  if (!trimmed) return null;

  // Find where the geometry type starts
  const geomTypeIdx  = trimmed.indexOf(',"MultiPolygon"');
  const geomTypeIdx2 = trimmed.indexOf(',"Polygon"');
  const gtIdx = Math.min(
    geomTypeIdx  >= 0 ? geomTypeIdx  : Infinity,
    geomTypeIdx2 >= 0 ? geomTypeIdx2 : Infinity
  );
  if (!isFinite(gtIdx)) return null;

  const prefix = trimmed.substring(0, gtIdx);    // ,"{d_id}",{id},"{p3d}","{prov}","{dist}"
  const suffix = trimmed.substring(gtIdx + 1);   // "MultiPolygon","[[...]]","jk"

  // Parse prefix: split on '","' → [',"d_id",id,"p3d', 'province', 'district']
  const prefixParts = prefix.split('","');
  const province = prefixParts[1] || '';
  const district = (prefixParts[2] || '').replace(/"$/, '');

  // First part: ,"10103",1,"10200"  (or similar)
  const fp = prefixParts[0].startsWith(',') ? prefixParts[0].substring(1) : prefixParts[0];
  const fpParts = fp.split(',');   // ["10103", 1, "10200"]
  const district_id = fpParts[0].replace(/"/g, '').trim();
  const rowId       = parseInt(fpParts[1]);
  const p3d_id      = fpParts[2] ? fpParts[2].replace(/"/g, '').trim() : '';

  // Parse suffix: "MultiPolygon","[[...]]","0"
  const geomTypeSplit  = suffix.indexOf('","');
  const geom_type      = suffix.substring(0, geomTypeSplit).replace(/"/g, '').trim();
  const afterType      = suffix.substring(geomTypeSplit + 3); // [[...]]","0"

  // jmlh_kk = last ","digits" at end
  const jkMatch    = afterType.match(/","(\d+)"$/);
  const jmlh_kk    = jkMatch ? parseInt(jkMatch[1]) : 0;
  const geom_coordinates = afterType.substring(0, afterType.lastIndexOf('","'));

  return { district_id, id: rowId, p3d_id, province, district, geom_type, geom_coordinates, jmlh_kk };
}

// ── upsert ────────────────────────────────────────────────────────────────────

async function upsertDistrict(client, row) {
  const {
    district_id, p3d_id, province, district,
    geom_type, geom_coordinates, jmlh_kk
  } = row;

  // Rebuild the full GeoJSON geometry string
  const geomJson = JSON.stringify({
    type: geom_type,
    coordinates: JSON.parse(geom_coordinates),
  });

  await client.query(`
    INSERT INTO district_boundaries
           (district_id, district, p3d_id, p3d, jmlh_kk,
            geom_postgis, geom_json, updated_at)
    VALUES ($1, $2, $3, $4, $5,
            ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)),
            $6, NOW())
    ON CONFLICT (district_id) DO UPDATE SET
      district     = EXCLUDED.district,
      p3d_id       = EXCLUDED.p3d_id,
      p3d          = EXCLUDED.p3d,
      jmlh_kk      = EXCLUDED.jmlh_kk,
      geom_postgis = ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)),
      geom_json    = EXCLUDED.geom_json,
      updated_at   = NOW()
  `, [district_id, district, p3d_id, province, jmlh_kk, geomJson]);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(65));
  console.log('Import district_boundaries from CSV export (old DB)');
  console.log(`CSV: ${CSV_FILE}`);
  console.log(`DRY_RUN: ${DRY_RUN}`);
  console.log('='.repeat(65));

  if (!fs.existsSync(CSV_FILE)) {
    console.error(`\nERROR: CSV file not found:\n  ${CSV_FILE}`);
    console.error('\nMake sure the data_lama folder is present at:');
    console.error('  data/boundaries/data_lama/');
    process.exit(1);
  }

  const lines = fs.readFileSync(CSV_FILE, 'utf8').split('\n');
  console.log(`\nCSV header: ${lines[0]}`);
  const dataLines = lines.slice(1).filter(l => l.trim().length > 0);
  console.log(`Data rows to import: ${dataLines.length}\n`);

  if (DRY_RUN) {
    console.log('[DRY RUN] Parsing and showing first 5 rows:\n');
    for (const line of dataLines.slice(0, 5)) {
      const row = parseCSVLine(line);
      if (row) {
        console.log(
          `  district_id=${row.district_id} | p3d_id=${row.p3d_id}` +
          ` | province=${row.province} | district=${row.district}` +
          ` | jmlh_kk=${row.jmlh_kk}`
        );
      }
    }
    console.log('\n[DRY RUN] No DB changes made.');
    return;
  }

  const client = await pool.connect();
  try {
    // Ensure schema is up to date
    const schemaFile = path.join(__dirname, '..', 'sql', '003_district_village_boundaries.sql');
    if (fs.existsSync(schemaFile)) {
      console.log('Running schema migration (003_district_village_boundaries.sql)...');
      await client.query(fs.readFileSync(schemaFile, 'utf8'));
      console.log('Schema OK\n');
    }

    await client.query('BEGIN');

    let ok = 0, fail = 0, skip = 0;

    for (let i = 0; i < dataLines.length; i++) {
      const row = parseCSVLine(dataLines[i]);

      if (!row) { skip++; continue; }

      if (!row.district_id || !row.p3d_id) {
        console.warn(`  SKIP line ${i + 2}: missing district_id or p3d_id`);
        skip++;
        continue;
      }

      try {
        await upsertDistrict(client, row);
        ok++;
        if (ok % 50 === 0) process.stdout.write(`  Imported ${ok}/${dataLines.length}...\n`);
      } catch (err) {
        fail++;
        console.error(`  ERR line ${i + 2} [${row.district_id}] ${row.district}: ${err.message}`);
      }
    }

    await client.query('COMMIT');

    console.log('\n' + '='.repeat(65));
    console.log(`✅ Import complete: ${ok} ok, ${fail} failed, ${skip} skipped`);
    console.log('='.repeat(65));

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFatal error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
