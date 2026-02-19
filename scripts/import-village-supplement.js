'use strict';
/**
 * import-village-supplement.js
 * 
 * Supplements village_boundaries table with desa data for kecamatan 
 * that are missing from the village-boundaries.json export.
 * 
 * Source: data/boundaries/Desa/desa.geojson (BPS codes)
 * 
 * Covered (10 of 15 missing kecamatan):
 * - 7 with exact BPS-to-p3d match by name+kabupaten
 * - 3 with kabupaten reclassification (CIJAMBE, TANJUNGSIANG, COMPRENG)
 * 
 * NOT covered (5 kecamatan genuinely absent from desa.geojson):
 * - 10214 SUKARESMI (BOGOR)  - only in CIANJUR/GARUT in desa.geojson
 * - 10547 CAMPAKA (SUBANG)   - only in CIANJUR/PURWAKARTA
 * - 10555 CIBATU (SUBANG)    - only in GARUT/PURWAKARTA
 * - 10365 SUBANG (CIAMIS)    - only in KUNINGAN/SUBANG
 * - 10686 LEMAHWUNGKUK (CIREBON) - not in desa.geojson at all
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DRY_RUN = process.env.DRY_RUN === '1';

// Manual BPS 6-digit kecamatan code -> p3d district_id mapping
// Derived from analysis of desa.geojson vs district_boundaries CSV
const BPS_KEC_TO_DISTRICT = {
  '321305': '10516',  // PABUARAN, KAB SUBANG (exact match)
  '321311': '10524',  // PAMANUKAN, KAB SUBANG (exact match)
  '321321': '10525',  // LEGONKULON, KAB SUBANG (exact match)
  '321307': '10540',  // PAGADEN, KAB SUBANG (exact match)
  '321325': '10543',  // TAMBAKDAHAN, KAB SUBANG (exact match)
  '327405': '10685',  // KESAMBI, KOTA CIREBON (match, p3d says KAB CIREBON)
  '327403': '10687',  // HARJAMUKTI, KOTA CIREBON (match, p3d says KAB CIREBON)
  '321319': '10529',  // CIJAMBE, desa.geojson says SUBANG, p3d says SUMEDANG
  '321314': '10534',  // TANJUNGSIANG, desa.geojson says SUBANG, p3d says SUMEDANG
  '321315': '10520',  // COMPRENG, desa.geojson says SUBANG, p3d says INDRAMAYU
};

const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'nominatim',
  user: process.env.DB_USER || 'nominatim',
  password: process.env.DB_PASSWORD || 'nominatim',
});

async function main() {
  console.log(DRY_RUN ? '[DRY RUN]' : '[LIVE]', 'Loading desa.geojson supplement...');

  const geojsonPath = path.join(__dirname, '..', 'data', 'boundaries', 'Desa', 'desa.geojson');
  const raw = fs.readFileSync(geojsonPath, 'utf8');
  const geojson = JSON.parse(raw);
  console.log('Total features in desa.geojson:', geojson.features.length);

  // Filter features to only those with a known BPS kec mapping
  const targeted = geojson.features.filter(f => {
    const bpsKec = String(f.properties.KODE || '');
    return BPS_KEC_TO_DISTRICT[bpsKec] !== undefined;
  });
  console.log('Features matching supplement targets:', targeted.length);

  if (DRY_RUN) {
    // Show sample
    const sample = targeted.slice(0, 3);
    sample.forEach(f => {
      const bpsKec = String(f.properties.KODE || '');
      const distId = BPS_KEC_TO_DISTRICT[bpsKec];
      console.log('  district_id=%s | bps_desa=%s | village=%s | geom_type=%s',
        distId,
        f.properties.KODE_DESA,
        f.properties.DESA || f.properties.DESA_KELUR,
        f.geometry ? f.geometry.type : 'null'
      );
    });
    // Count by district
    const countByDist = {};
    targeted.forEach(f => {
      const bpsKec = String(f.properties.KODE || '');
      const distId = BPS_KEC_TO_DISTRICT[bpsKec];
      countByDist[distId] = (countByDist[distId] || 0) + 1;
    });
    console.log('\nDesa count by district_id:');
    Object.entries(countByDist).sort().forEach(([id, cnt]) =>
      console.log('  district_id=%s : %d desa', id, cnt)
    );
    console.log('\n[DRY RUN] No changes made');
    return;
  }

  const client = await db.connect();
  let inserted = 0, skipped = 0, errors = 0;

  try {
    for (const f of targeted) {
      const bpsKec = String(f.properties.KODE || '');
      const distId = BPS_KEC_TO_DISTRICT[bpsKec];
      const bpsDesa = f.properties.KODE_DESA ? String(f.properties.KODE_DESA) : null;
      const village = (f.properties.DESA || f.properties.DESA_KELUR || '').toUpperCase();
      const kecNm = (f.properties.KECAMATAN || '').toUpperCase();
      const geom = f.geometry;

      if (!geom || !village) { skipped++; continue; }

      // Convert to WKT-style via ST_GeomFromGeoJSON
      const geomJson = JSON.stringify(geom);

      try {
        // ST_Multi() wraps Polygon into MultiPolygon if needed
        await client.query(`
          INSERT INTO village_boundaries (district_id, village, unique_code, geom_postgis, geom_json)
          VALUES ($1, $2, $3,
            ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)),
            $4)
          ON CONFLICT (unique_code) WHERE unique_code IS NOT NULL DO NOTHING
        `, [distId, village, bpsDesa, geomJson]);
        inserted++;
      } catch (e) {
        console.error('Error inserting', village, kecNm, ':', e.message);
        errors++;
      }

      if ((inserted + skipped + errors) % 50 === 0) {
        process.stdout.write(`\r  Progress: ${inserted} inserted, ${skipped} skipped, ${errors} errors`);
      }
    }
    console.log(`\nDone: ${inserted} inserted, ${skipped} skipped, ${errors} errors`);
  } finally {
    client.release();
    await db.end();
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
