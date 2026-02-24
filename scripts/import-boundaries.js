/**
 * Import Administrative Boundaries dari GADM GeoJSON
 *
 * Sumber data: https://gadm.org/download_country.html
 *   → Pilih "Indonesia", format "GeoJSON"
 *   → Download level 1 (Provinsi), level 2 (Kota/Kab), level 3 (Kecamatan)
 *
 * Letakkan file-file berikut di folder data/boundaries/:
 *   - gadm41_IDN_1.json   (Provinsi)
 *   - gadm41_IDN_2.json   (Kota/Kabupaten)
 *   - gadm41_IDN_3.json   (Kecamatan)
 *
 * Atau bisa juga dari sumber lain (BPS, geoBoundaries, OSM extract)
 * asalkan berupa GeoJSON FeatureCollection.
 *
 * Usage:
 *   # Dari host (jika pg accessible di localhost:5432):
 *   PGHOST=localhost node scripts/import-boundaries.js
 *
 *   # Dari dalam container:
 *   docker exec osrm-tile-service node scripts/import-boundaries.js
 *
 * Options (env vars):
 *   FILTER_PROVINCE  - Hanya import provinsi tertentu (e.g. "Jawa Barat,Jawa Tengah,Jawa Timur")
 *   SKIP_LEVEL       - Skip level tertentu (e.g. "3" untuk skip kecamatan)
 *   DRY_RUN=1        - Preview tanpa insert ke DB
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ─── Config ────────────────────────────────────────────────
const BOUNDARIES_DIR = path.join(__dirname, '..', 'data', 'boundaries');

const pool = new Pool({
  host: process.env.PGHOST || 'postgres',
  port: parseInt(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'nominatim',
  user: process.env.PGUSER || 'nominatim',
  password: process.env.PGPASSWORD || 'nominatim123',
  connectionTimeoutMillis: 10000,
});

const FILTER_PROVINCE = process.env.FILTER_PROVINCE
  ? process.env.FILTER_PROVINCE.split(',').map(s => s.trim().toLowerCase())
  : null; // null = import semua

const SKIP_LEVEL = process.env.SKIP_LEVEL
  ? process.env.SKIP_LEVEL.split(',').map(s => parseInt(s.trim()))
  : [];

const DRY_RUN = process.env.DRY_RUN === '1';

// ─── GADM field mapping ────────────────────────────────────
// GADM GeoJSON properties:
//   Level 1: GID_1, NAME_1, GID_0, COUNTRY
//   Level 2: GID_2, NAME_2, GID_1, NAME_1
//   Level 3: GID_3, NAME_3, GID_2, NAME_2
//
// We map GADM codes like "IDN.9_1" → "IDN.9" prefix for parent lookup

const LEVEL_CONFIG = {
  1: {
    file: 'gadm41_IDN_1.json',
    admin_level: 'province',
    getName: (p) => p.NAME_1,
    getCode: (p) => p.GID_1,           // e.g. "IDN.9_1"
    getParentCode: () => null,           // no parent
    matchProvince: (p) => p.NAME_1,
  },
  2: {
    file: 'gadm41_IDN_2.json',
    admin_level: 'city',
    getName: (p) => p.NAME_2,
    getCode: (p) => p.GID_2,           // e.g. "IDN.9.1_1"
    getParentCode: (p) => p.GID_1,      // e.g. "IDN.9_1"
    matchProvince: (p) => p.NAME_1,
  },
  3: {
    file: 'gadm41_IDN_3.json',
    admin_level: 'district',
    getName: (p) => p.NAME_3,
    getCode: (p) => p.GID_3,           // e.g. "IDN.9.1.1_1"
    getParentCode: (p) => p.GID_2,      // e.g. "IDN.9.1_1"
    matchProvince: (p) => p.NAME_1,
  },
};

// ─── Helpers ───────────────────────────────────────────────

function readGeoJSON(filePath) {
  console.log(`  📂 Membaca ${path.basename(filePath)} ...`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const geojson = JSON.parse(raw);
  if (geojson.type !== 'FeatureCollection') {
    throw new Error(`File bukan FeatureCollection: ${geojson.type}`);
  }
  console.log(`     → ${geojson.features.length} features ditemukan`);
  return geojson;
}

function shouldInclude(feature, config) {
  if (!FILTER_PROVINCE) return true;
  const provName = config.matchProvince(feature.properties);
  return FILTER_PROVINCE.some(f => provName.toLowerCase().includes(f));
}

function ensureMultiPolygon(geometry) {
  if (geometry.type === 'Polygon') {
    return { type: 'MultiPolygon', coordinates: [geometry.coordinates] };
  }
  return geometry;
}

// ─── Main import ───────────────────────────────────────────

async function importLevel(client, level) {
  const config = LEVEL_CONFIG[level];
  if (!config) throw new Error(`Unknown level: ${level}`);

  const filePath = path.join(BOUNDARIES_DIR, config.file);

  // Check for alternative file names
  let actualPath = filePath;
  if (!fs.existsSync(actualPath)) {
    // Try without version number
    const alt = path.join(BOUNDARIES_DIR, `gadm_IDN_${level}.json`);
    if (fs.existsSync(alt)) actualPath = alt;
    else {
      // Try any file matching pattern
      const files = fs.readdirSync(BOUNDARIES_DIR).filter(f =>
        f.toLowerCase().includes(`_idn_${level}`) && f.endsWith('.json')
      );
      if (files.length > 0) {
        actualPath = path.join(BOUNDARIES_DIR, files[0]);
      } else {
        console.log(`  ⚠️  File ${config.file} tidak ditemukan, skip level ${level}`);
        return 0;
      }
    }
  }

  const geojson = readGeoJSON(actualPath);

  let imported = 0;
  let skipped = 0;

  for (const feature of geojson.features) {
    if (!shouldInclude(feature, config)) {
      skipped++;
      continue;
    }

    const props = feature.properties;
    const name = config.getName(props);
    const code = config.getCode(props);
    const parentCode = config.getParentCode(props);
    const geom = ensureMultiPolygon(feature.geometry);

    if (!name || !code) {
      console.log(`     ⚠️  Skip feature tanpa nama/kode:`, props);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`     [DRY] ${config.admin_level} | ${code} | ${name} | parent=${parentCode || '-'}`);
      imported++;
      continue;
    }

    try {
      // Check if code already exists
      const existing = await client.query(
        'SELECT id FROM administrative_boundaries WHERE code = $1',
        [code]
      );

      if (existing.rows.length > 0) {
        // Update geometry
        await client.query(`
          UPDATE administrative_boundaries
          SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
              name = $2,
              is_active = TRUE,
              updated_at = NOW()
          WHERE code = $3
        `, [JSON.stringify(geom), name, code]);
      } else {
        // Find parent ID
        let parentId = null;
        if (parentCode) {
          const parentResult = await client.query(
            'SELECT id FROM administrative_boundaries WHERE code = $1 AND is_active = TRUE',
            [parentCode]
          );
          if (parentResult.rows.length > 0) {
            parentId = parentResult.rows[0].id;
          }
        }

        await client.query(`
          INSERT INTO administrative_boundaries (parent_id, admin_level, code, name, geom)
          VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326))
        `, [parentId, config.admin_level, code, name, JSON.stringify(geom)]);
      }

      imported++;

      // Progress indicator
      if (imported % 50 === 0) {
        process.stdout.write(`     ✔ ${imported} imported...\r`);
      }
    } catch (err) {
      console.error(`     ❌ Error importing ${code} (${name}):`, err.message);
    }
  }

  console.log(`     ✅ Level ${level} (${config.admin_level}): ${imported} imported, ${skipped} skipped`);
  return imported;
}

async function run() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  📥 Import Administrative Boundaries');
  console.log('═══════════════════════════════════════════════════');

  if (!fs.existsSync(BOUNDARIES_DIR)) {
    console.error(`\n❌ Folder tidak ditemukan: ${BOUNDARIES_DIR}`);
    console.log('\n📋 Langkah-langkah:');
    console.log('   1. Buka https://gadm.org/download_country.html');
    console.log('   2. Pilih "Indonesia" → Format "GeoJSON"');
    console.log('   3. Download level 1, 2, dan 3');
    console.log(`   4. Taruh file di: ${BOUNDARIES_DIR}/`);
    console.log('        - gadm41_IDN_1.json  (Provinsi)');
    console.log('        - gadm41_IDN_2.json  (Kota/Kabupaten)');
    console.log('        - gadm41_IDN_3.json  (Kecamatan)');
    console.log('   5. Jalankan ulang script ini\n');
    process.exit(1);
  }

  const availableFiles = fs.readdirSync(BOUNDARIES_DIR).filter(f => f.endsWith('.json'));
  console.log(`\n📂 Folder: ${BOUNDARIES_DIR}`);
  console.log(`   File ditemukan: ${availableFiles.join(', ') || '(kosong)'}`);

  if (availableFiles.length === 0) {
    console.error('\n❌ Tidak ada file GeoJSON di folder boundaries/');
    process.exit(1);
  }

  if (FILTER_PROVINCE) {
    console.log(`\n🔍 Filter provinsi: ${FILTER_PROVINCE.join(', ')}`);
  }
  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN MODE — tidak ada data yang disimpan');
  }

  const client = await pool.connect();
  let totalImported = 0;

  try {
    if (!DRY_RUN) {
      await client.query('BEGIN');

      // Clear old seed data / previous import
      console.log('\n🗑️  Menghapus data boundary lama...');
      await client.query('DELETE FROM boundary_split_history');
      await client.query('DELETE FROM administrative_boundaries');
      // Reset sequence
      await client.query("SELECT setval('administrative_boundaries_id_seq', 1, false)");
    }

    // Import level by level (order matters for parent_id references)
    for (const level of [1, 2, 3]) {
      if (SKIP_LEVEL.includes(level)) {
        console.log(`\n⏭️  Skip level ${level}`);
        continue;
      }
      console.log(`\n📥 Importing level ${level} (${LEVEL_CONFIG[level].admin_level})...`);
      const count = await importLevel(client, level);
      totalImported += count;
    }

    if (!DRY_RUN) {
      await client.query('COMMIT');
    }

    console.log('\n═══════════════════════════════════════════════════');
    console.log(`  ✅ Import selesai! Total: ${totalImported} wilayah`);
    console.log('═══════════════════════════════════════════════════');

    // Show summary
    if (!DRY_RUN) {
      const summary = await client.query(`
        SELECT admin_level, COUNT(*) as count
        FROM administrative_boundaries
        WHERE is_active = TRUE
        GROUP BY admin_level
        ORDER BY admin_level
      `);
      console.log('\n📊 Ringkasan:');
      summary.rows.forEach(r => {
        console.log(`   ${r.admin_level}: ${r.count} wilayah`);
      });
    }

  } catch (err) {
    if (!DRY_RUN) await client.query('ROLLBACK');
    console.error('\n❌ Import gagal:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
