/**
 * Import Boundary Jawa Barat  3 file sumber:
 *
 *   data/boundaries/Jabar_By_Kab.geojson   -> Kabupaten/Kota
 *   data/boundaries/Jabar_By_Kec.geojson   -> Kecamatan
 *   data/boundaries/Desa/desa.geojson      -> Kelurahan/Desa
 *
 * Usage:
 *   DRY_RUN=1  node scripts/import-jabar-boundaries.js
 *   docker exec osrm-tile-service node scripts/import-jabar-boundaries.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BOUNDARIES_DIR = path.join(__dirname, '..', 'data', 'boundaries');
const KAB_FILE  = path.join(BOUNDARIES_DIR, 'Jabar_By_Kab.geojson');
const KEC_FILE  = path.join(BOUNDARIES_DIR, 'Jabar_By_Kec.geojson');
const DESA_FILE = path.join(BOUNDARIES_DIR, 'Desa', 'desa.geojson');

const pool = new Pool({
  host:     process.env.PGHOST     || 'postgres',
  port:     parseInt(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'nominatim',
  user:     process.env.PGUSER     || 'nominatim',
  password: process.env.PGPASSWORD || 'nominatim123',
  connectionTimeoutMillis: 10000,
});

const DRY_RUN = process.env.DRY_RUN === '1';

function readGeoJSON(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File tidak ditemukan: ${filePath}`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!data.features) throw new Error(`Bukan valid GeoJSON: ${filePath}`);
  return data.features.filter(f => f.geometry &&
    (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
}

function toMultiPolygon(geom) {
  if (!geom) return null;
  if (geom.type === 'Polygon') return { type: 'MultiPolygon', coordinates: [geom.coordinates] };
  return geom;
}

async function upsert(client, { parentId, adminLevel, code, name, geom, metadata }) {
  const sp = `sp_${code}`;
  await client.query(`SAVEPOINT "${sp}"`);
  try {
    const r = await client.query(`
      INSERT INTO administrative_boundaries
             (parent_id, admin_level, code, name, geom, metadata)
      VALUES ($1, $2::admin_level_enum, $3, $4,
              ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)),
              $6::jsonb)
      ON CONFLICT (code) DO UPDATE SET
        parent_id   = EXCLUDED.parent_id,
        admin_level = EXCLUDED.admin_level,
        name        = EXCLUDED.name,
        geom        = ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)),
        metadata    = EXCLUDED.metadata,
        is_active   = TRUE,
        updated_at  = NOW()
      RETURNING id
    `, [parentId, adminLevel, code, name,
        JSON.stringify(toMultiPolygon(geom)),
        JSON.stringify(metadata || {})]);
    await client.query(`RELEASE SAVEPOINT "${sp}"`);
    return r.rows[0].id;
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT "${sp}"`);
    throw err;
  }
}

async function importProvinsi(client) {
  console.log('\n-- Step 1: Provinsi JAWA BARAT --');
  const code = '32'; const name = 'JAWA BARAT';
  if (DRY_RUN) { console.log(`   [DRY] province | ${code} | ${name}`); return -1; }
  const placeholder = { type: 'MultiPolygon', coordinates: [[[[106.0,-6.0],[108.8,-6.0],[108.8,-8.0],[106.0,-8.0],[106.0,-6.0]]]] };
  const id = await upsert(client, { parentId: null, adminLevel: 'province', code, name, geom: placeholder, metadata: { source: 'hardcoded' } });
  console.log(`   OK province | ${code} | ${name} -> id=${id}`);
  return id;
}

async function importKabupaten(client, provinsiId) {
  console.log('\n-- Step 2: Kabupaten / Kota --');
  const features = readGeoJSON(KAB_FILE);
  console.log(`   ${features.length} features`);
  const kabMap = {}; let ok = 0, fail = 0;
  for (const f of features) {
    const p    = f.properties;
    // Gunakan ID_KAB langsung (sudah 4-digit benar, e.g. 3201, 3218)
    const code = String(p.ID_KAB);
    const name = p.KABKOT || `Kab ${code}`;
    if (DRY_RUN) { kabMap[p.ID_KAB] = { id: -1, name, code }; console.log(`   [DRY] city | ${code} | ${name}`); ok++; continue; }
    try {
      const id = await upsert(client, { parentId: provinsiId, adminLevel: 'city', code, name, geom: f.geometry, metadata: { OBJECTID: p.OBJECTID } });
      kabMap[p.ID_KAB] = { id, name, code }; ok++;
    } catch (err) { fail++; console.error(`   ERR [${code}] ${name}: ${err.message}`); }
  }
  console.log(`   -> ${ok} imported, ${fail} failed`);
  return kabMap;
}

async function importKecamatan(client, kabMap) {
  console.log('\n-- Step 3: Kecamatan --');
  const features = readGeoJSON(KEC_FILE);
  console.log(`   ${features.length} features`);
  const kecMap = {}; let ok = 0, fail = 0, skip = 0;
  for (const f of features) {
    const p    = f.properties;
    const code = String(p.ID_KEC);
    const name = p.KECAMATAN || `Kec ${code}`;
    const kabInfo  = kabMap[p.ID_KAB];
    const parentId = kabInfo ? kabInfo.id : null;
    if (!parentId && !DRY_RUN) { skip++; continue; }
    if (DRY_RUN) { kecMap[p.ID_KEC] = { id: -1, name, code }; ok++; continue; }
    try {
      const id = await upsert(client, { parentId, adminLevel: 'district', code, name, geom: f.geometry, metadata: { ID_KAB: p.ID_KAB, KABKOT: p.KABKOT } });
      kecMap[p.ID_KEC] = { id, name, code }; ok++;
      if (ok % 100 === 0) process.stdout.write(`   ${ok}...\r`);
    } catch (err) { fail++; if (fail <= 5) console.error(`   ERR [${code}] ${name}: ${err.message}`); }
  }
  console.log(`   -> ${ok} imported, ${fail} failed, ${skip} skipped`);
  return kecMap;
}

async function importDesa(client, kecMap) {
  console.log('\n-- Step 4: Desa / Kelurahan --');
  const features = readGeoJSON(DESA_FILE);
  console.log(`   ${features.length} features`);
  let ok = 0, fail = 0, skip = 0;
  for (const f of features) {
    const p    = f.properties;
    const code = String(p.KODE_DESA);
    const name = p.DESA_KELUR || p.DESA || `Desa ${code}`;
    if (!code || code === 'undefined') { skip++; continue; }
    const kecInfo  = kecMap[p.KODE];
    const parentId = kecInfo ? kecInfo.id : null;
    if (DRY_RUN) { ok++; continue; }
    const sp = `sp_${code}`;
    try {
      await client.query(`SAVEPOINT "${sp}"`);
      await upsert(client, { parentId, adminLevel: 'village', code, name, geom: f.geometry,
        metadata: { KODE: p.KODE, KAB_KOTA: p.KAB_KOTA, KECAMATAN: p.KECAMATAN, JUMLAH_PEN: p.JUMLAH_PEN, JUMLAH_KK: p.JUMLAH_KK, LUAS_WILAY: p.LUAS_WILAY, source: 'desa.geojson' } });
      await client.query(`RELEASE SAVEPOINT "${sp}"`);
      ok++;
      if (ok % 500 === 0) process.stdout.write(`   ${ok}...\r`);
    } catch (err) {
      try { await client.query(`ROLLBACK TO SAVEPOINT "${sp}"`); } catch (_) {}
      fail++; if (fail <= 10) console.error(`   ERR [${code}] ${name}: ${err.message}`);
    }
  }
  console.log(`   -> ${ok} imported, ${fail} failed, ${skip} skipped`);
}

async function updateProvinsiGeom(client, provinsiId) {
  console.log('\n-- Step 5: Update geometri provinsi --');
  if (DRY_RUN) { console.log('   [DRY] skip'); return; }
  await client.query(`
    UPDATE administrative_boundaries SET geom = (
      SELECT ST_Multi(ST_Union(geom)) FROM administrative_boundaries
      WHERE parent_id = $1 AND is_active = TRUE
    ), updated_at = NOW() WHERE id = $1
  `, [provinsiId]);
  console.log('   OK');
}

async function main() {
  console.log('=======================================================');
  console.log('  Import Boundary Jawa Barat');
  console.log('  Jabar_By_Kab + Jabar_By_Kec + Desa/desa.geojson');
  console.log('=======================================================');
  if (DRY_RUN) console.log('\nDRY RUN MODE\n');
  const t0 = Date.now(); let client;
  if (DRY_RUN) {
    client = { query: async () => ({ rows: [] }) };
  } else {
    client = await pool.connect();
    console.log('Connected to DB');
    try { await client.query("ALTER TYPE admin_level_enum ADD VALUE IF NOT EXISTS 'village'"); console.log('Enum village OK'); }
    catch (_) { console.log('Enum village sudah ada'); }
    await client.query('BEGIN');
    console.log('Clear data lama...');
    await client.query('DELETE FROM boundary_split_history');
    await client.query('DELETE FROM administrative_boundaries');
    await client.query("SELECT setval('administrative_boundaries_id_seq', 1, false)");
  }
  try {
    const provinsiId = await importProvinsi(client);
    const kabMap     = await importKabupaten(client, provinsiId);
    const kecMap     = await importKecamatan(client, kabMap);
                       await importDesa(client, kecMap);
                       await updateProvinsiGeom(client, provinsiId);
    if (!DRY_RUN) {
      await client.query('COMMIT');
      const s = await client.query(`SELECT admin_level, COUNT(*) n FROM administrative_boundaries WHERE is_active=TRUE GROUP BY admin_level ORDER BY admin_level`);
      console.log('\n=== HASIL ===');
      s.rows.forEach(r => console.log(`  ${r.admin_level.padEnd(12)}: ${r.n}`));
    }
    console.log(`\nSelesai dalam ${((Date.now()-t0)/1000).toFixed(1)}s`);
  } catch (err) {
    if (!DRY_RUN) await client.query('ROLLBACK');
    console.error('IMPORT GAGAL:', err.message); process.exit(1);
  } finally {
    if (!DRY_RUN) client.release();
    await pool.end();
  }
}

main();
