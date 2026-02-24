'use strict';

const fs   = require('fs');
const path = require('path');

const DRY_RUN = process.env.DRY_RUN === '1';

const SOURCE_PATH = path.join(
  __dirname, '..', 'data', 'boundaries', 'data_lama', 'Desa', 'village-boundaries.json'
);

let pool;
if (!DRY_RUN) {
  ({ pool } = require('../src/db'));
}

async function main() {
  console.log(`[import-village-boundaries] DRY_RUN=${DRY_RUN}`);
  console.log(`Reading ${SOURCE_PATH}...`);

  const records = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
  console.log(`Total records: ${records.length}`);

  if (DRY_RUN) {
    console.log('\n-- DRY RUN preview (first 5 rows) --');
    records.slice(0, 5).forEach((r, i) => {
      const geom = r.geom || r.geometry;
      console.log(
        `[${i}] district_id=${r.district_id} | unique_code=${r.unique_code} | ` +
        `village=${r.village} | p3d_id=${r.p3d_id} | geom=${geom && geom.type}`
      );
    });
    console.log('\nDry run complete. No data written.');
    return;
  }

  const sql = `
    INSERT INTO village_boundaries
      (district_id, village, unique_code, p3d_id, p3d, geom_postgis, geom_json)
    VALUES (
      $1, $2, $3, $4, $5,
      ST_SetSRID(ST_GeomFromGeoJSON($6), 4326),
      $6
    )
    ON CONFLICT (unique_code) WHERE unique_code IS NOT NULL
    DO UPDATE SET
      district_id  = EXCLUDED.district_id,
      village      = EXCLUDED.village,
      p3d_id       = EXCLUDED.p3d_id,
      p3d          = EXCLUDED.p3d,
      geom_postgis = EXCLUDED.geom_postgis,
      geom_json    = EXCLUDED.geom_json,
      updated_at   = NOW()
  `;

  let inserted = 0, skipped = 0, errors = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const districtId = r.district_id ? String(r.district_id).trim() : null;
    const village    = r.village     ? String(r.village).trim()     : null;
    const uniqueCode = r.unique_code ? String(r.unique_code).trim() : null;
    const p3dId      = r.p3d_id      ? String(r.p3d_id).trim()      : null;
    const p3d        = r.p3d         ? String(r.p3d).trim()          : null;
    const geom       = r.geom || r.geometry;

    if (!districtId || !village) { skipped++; continue; }
    if (!geom) { skipped++; continue; }

    try {
      await pool.query(sql, [districtId, village, uniqueCode, p3dId, p3d, JSON.stringify(geom)]);
      inserted++;
    } catch (err) {
      console.error(`[${i}] Error ${uniqueCode} (${village}):`, err.message);
      errors++;
    }

    if ((i + 1) % 500 === 0) {
      console.log(`  Progress: ${i + 1}/${records.length} inserted=${inserted} skipped=${skipped} errors=${errors}`);
    }
  }

  console.log(`\nDone. inserted/updated=${inserted}, skipped=${skipped}, errors=${errors}`);
  await pool.end();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
