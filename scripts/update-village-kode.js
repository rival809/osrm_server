/**
 * update-village-kode.js
 * ──────────────────────────────────────────────────────────────
 * Update kode desa/kecamatan/kabupaten di tabel village_boundaries
 * berdasarkan referensi mapping dari file JSON.
 *
 * Asumsi:
 * - File referensi: data/boundaries/village-kode-mapping.json
 *   Format: [
 *     {
 *       "village": "NAMA DESA",
 *       "kecamatan": "NAMA KECAMATAN",
 *       "kabupaten": "NAMA KABUPATEN",
 *       "kode_desa": "XXXXX",
 *       "kode_kec": "XXXXX",
 *       "kode_kab": "XXXXX"
 *     }, ...
 *   ]
 * - Kolom di tabel village_boundaries: village, p3d (kecamatan), kabupaten, kode_desa, kode_kec, kode_kab
 *
 * Jalankan dengan:
 *   node scripts/update-village-kode.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const pgModule = (() => {
  try { return require('pg'); } catch (_) {}
  try { return require('/app/node_modules/pg'); } catch (_) {}
  throw new Error('Cannot find module pg');
})();
const { Pool } = pgModule;

const MAPPING_FILE = path.join(__dirname, '..', 'data', 'boundaries', 'village-kode-mapping.json');

const pool = new Pool({
  host:     process.env.PGHOST     || 'postgres',
  port:     parseInt(process.env.PGPORT)  || 5432,
  database: process.env.PGDATABASE || 'nominatim',
  user:     process.env.PGUSER     || 'nominatim',
  password: process.env.PGPASSWORD || 'nominatim123',
  connectionTimeoutMillis: 15000,
  statement_timeout: 120000,
});

const norm = s => (s || '').toUpperCase().trim().replace(/\s+/g, ' ');

async function main() {
  const client = await pool.connect();
  let updated = 0, notFound = 0;
  try {
    const mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
    for (const row of mapping) {
      const vName = norm(row.village);
      const kName = norm(row.kecamatan);
      const kabName = norm(row.kabupaten);
      const { kode_desa, kode_kec, kode_kab } = row;
      // Update berdasarkan nama desa, kecamatan, kabupaten
      const res = await client.query(
        `UPDATE village_boundaries
         SET kode_desa = $1, kode_kec = $2, kode_kab = $3
         WHERE UPPER(TRIM(village)) = $4
           AND UPPER(TRIM(p3d)) = $5
           AND UPPER(TRIM(kabupaten)) = $6`,
        [kode_desa, kode_kec, kode_kab, vName, kName, kabName]
      );
      if (res.rowCount > 0) updated += res.rowCount;
      else notFound++;
    }
    console.log(`Selesai. Baris terupdate: ${updated}, tidak ditemukan: ${notFound}`);
  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
