/**
 * import-village-geojson.js
 * ──────────────────────────────────────────────────────────────
 * Import data desa/kelurahan dari file GeoJSON ke tabel village_boundaries.
 *
 * Asumsi:
 * - File GeoJSON: data/boundaries/village.geojson
 * - Properti minimal: village, p3d (kecamatan), kabupaten
 * - Kolom geometry di tabel village_boundaries bertipe geometry (PostGIS)
 *
 * Jalankan dengan:
 *   node scripts/import-village-geojson.js
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

const GEOJSON_FILE = path.join(__dirname, '..', 'data', 'boundaries', 'village.geojson');

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
  let inserted = 0, skipped = 0;
  try {
    const geojson = JSON.parse(fs.readFileSync(GEOJSON_FILE, 'utf8'));
    if (!geojson.features || !Array.isArray(geojson.features)) throw new Error('Invalid GeoJSON');
    for (const feat of geojson.features) {
      const props = feat.properties || {};
      const village = norm(props.village || props.DESA || props.nama_desa);
      const p3d = norm(props.p3d || props.KECAMATAN || props.kecamatan);
      const kabupaten = norm(props.kabupaten || props.KABUPATEN);
      if (!village || !p3d || !kabupaten || !feat.geometry) {
        skipped++;
        continue;
      }
      // Insert ke DB
      await client.query(
        `INSERT INTO village_boundaries (village, p3d, kabupaten, geometry)
         VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326))
         ON CONFLICT DO NOTHING`,
        [village, p3d, kabupaten, JSON.stringify(feat.geometry)]
      );
      inserted++;
    }
    console.log(`Selesai. Baris masuk: ${inserted}, dilewati: ${skipped}`);
  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
