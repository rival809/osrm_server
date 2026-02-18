/**
 * Import Boundary Jawa Barat — data BPS (Kab/Kota, Kecamatan, Kelurahan/Desa)
 *
 * Sumber data:
 *   data/boundaries/Jabar_By_Kab.geojson              → Kabupaten/Kota
 *   data/boundaries/Kecamatan/XXXX_kecamatan.geojson   → Kecamatan per Kab
 *   data/boundaries/Kelurahan/XXXX_kelurahan.geojson   → Kelurahan per Kab
 *   data/boundaries/Desa/desa.geojson                  → Desa se-Jabar
 *
 * Hierarchy:  Provinsi → Kota/Kabupaten → Kecamatan → Kelurahan/Desa
 *
 * Usage:
 *   PGHOST=localhost node scripts/import-jabar-boundaries.js
 *   docker exec osrm-tile-service node scripts/import-jabar-boundaries.js
 *
 * Env vars:
 *   DRY_RUN=1          — Preview tanpa insert ke DB
 *   SKIP_VILLAGE=1     — Skip import kelurahan/desa (hanya kab + kecamatan)
 *   SKIP_KECAMATAN=1   — Skip import kecamatan + kelurahan/desa (hanya kab)
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ─── Config ────────────────────────────────────────────────
const BOUNDARIES_DIR = path.join(__dirname, '..', 'data', 'boundaries');
const KAB_FILE       = path.join(BOUNDARIES_DIR, 'Jabar_By_Kab.geojson');
const KEC_DIR        = path.join(BOUNDARIES_DIR, 'Kecamatan');
const KEL_DIR        = path.join(BOUNDARIES_DIR, 'Kelurahan');
const DESA_FILE      = path.join(BOUNDARIES_DIR, 'Desa', 'desa.geojson');

const pool = new Pool({
  host:     process.env.PGHOST     || 'postgres',
  port:     parseInt(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'nominatim',
  user:     process.env.PGUSER     || 'nominatim',
  password: process.env.PGPASSWORD || 'nominatim123',
  connectionTimeoutMillis: 10000,
});

const DRY_RUN        = process.env.DRY_RUN === '1';
const SKIP_VILLAGE   = process.env.SKIP_VILLAGE === '1';
const SKIP_KECAMATAN = process.env.SKIP_KECAMATAN === '1';

// ─── Helpers ───────────────────────────────────────────────

function readGeoJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const geojson = JSON.parse(raw);
  if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    throw new Error(`Bukan valid FeatureCollection: ${filePath}`);
  }
  return geojson;
}

function ensureMultiPolygon(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    return { type: 'MultiPolygon', coordinates: [geometry.coordinates] };
  }
  return geometry;
}

/**
 * Upsert satu boundary row, return id
 * Uses SAVEPOINT so a single failed insert doesn't abort the whole transaction
 */
async function upsertBoundary(client, { parentId, adminLevel, code, name, geom, metadata }) {
  const geomJson = JSON.stringify(geom);
  const metaJson = JSON.stringify(metadata || {});

  const savepointName = `sp_${code.replace(/[^a-zA-Z0-9]/g, '_')}`;
  await client.query(`SAVEPOINT ${savepointName}`);

  try {
    const result = await client.query(`
      INSERT INTO administrative_boundaries (parent_id, admin_level, code, name, geom, metadata)
      VALUES ($1, $2::admin_level_enum, $3, $4, ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)), $6::jsonb)
      ON CONFLICT (code) DO UPDATE SET
        parent_id   = EXCLUDED.parent_id,
        admin_level = EXCLUDED.admin_level,
        name        = EXCLUDED.name,
        geom        = ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)),
        metadata    = EXCLUDED.metadata,
        is_active   = TRUE,
        updated_at  = NOW()
      RETURNING id
    `, [parentId, adminLevel, code, name, geomJson, metaJson]);

    await client.query(`RELEASE SAVEPOINT ${savepointName}`);
    return result.rows[0].id;
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
    throw err;
  }
}

// ─── Step 1: Province ──────────────────────────────────────

async function importProvince(client) {
  console.log('\n── Step 1: Provinsi JAWA BARAT ──');

  // Placeholder geometry — will be replaced with ST_Union of all kabupaten
  const placeholderGeom = {
    type: 'MultiPolygon',
    coordinates: [[[[106.0, -6.0], [108.8, -6.0], [108.8, -8.0], [106.0, -8.0], [106.0, -6.0]]]]
  };

  if (DRY_RUN) {
    console.log('   [DRY] province | 32 | JAWA BARAT');
    return -1;
  }

  const id = await upsertBoundary(client, {
    parentId:   null,
    adminLevel: 'province',
    code:       '32',
    name:       'JAWA BARAT',
    geom:       placeholderGeom,
    metadata:   { PROVNO: '32', source: 'Jabar_By_Kab.geojson' }
  });

  console.log(`   ✅ Province JAWA BARAT → id=${id}`);
  return id;
}

// ─── Step 2: Kabupaten / Kota ──────────────────────────────

async function importKabupaten(client, provinceId) {
  console.log('\n── Step 2: Kabupaten / Kota ──');

  if (!fs.existsSync(KAB_FILE)) {
    console.error(`   ❌ File tidak ditemukan: ${KAB_FILE}`);
    return {};
  }

  const geojson = readGeoJSON(KAB_FILE);
  const features = geojson.features.filter(f =>
    f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
  );
  console.log(`   📂 ${path.basename(KAB_FILE)} → ${features.length} features`);

  const kabMap = {}; // code → { id, name }
  let imported = 0;
  let failed = 0;

  for (const feature of features) {
    const props = feature.properties;
    const code  = String(Math.round(parseFloat(props.ID_KAB)));  // 3201.0 → "3201"
    const name  = props.KABKOT || `Unknown`;
    const geom  = ensureMultiPolygon(feature.geometry);

    const metadata = {
      OBJECTID:   props.OBJECTID,
      KABKOTNO:   props.KABKOTNO,
      PROVNO:     props.PROVNO,
      Shape_Leng: props.Shape_Leng,
      Shape_Area: props.Shape_Area,
      source:     'Jabar_By_Kab.geojson'
    };

    if (DRY_RUN) {
      console.log(`   [DRY] city | ${code} | ${name}`);
      kabMap[code] = { id: -1, name };
      imported++;
      continue;
    }

    try {
      const id = await upsertBoundary(client, {
        parentId: provinceId, adminLevel: 'city', code, name, geom, metadata
      });
      kabMap[code] = { id, name };
      imported++;
      console.log(`   ✅ [${imported}/${features.length}] ${code} — ${name}`);
    } catch (err) {
      failed++;
      console.error(`   ❌ [${code}] ${name}: ${err.message}`);
    }
  }

  console.log(`   → Imported: ${imported}, Failed: ${failed}`);
  return kabMap;
}

// ─── Step 3: Kecamatan ─────────────────────────────────────

async function importKecamatan(client, kabMap) {
  console.log('\n── Step 3: Kecamatan ──');

  if (!fs.existsSync(KEC_DIR)) {
    console.error(`   ❌ Folder tidak ditemukan: ${KEC_DIR}`);
    return {};
  }

  const files = fs.readdirSync(KEC_DIR).filter(f => f.endsWith('_kecamatan.geojson')).sort();
  console.log(`   📂 ${files.length} file kecamatan ditemukan`);

  const kecMap = {}; // code → { id, name }
  let totalImported = 0;
  let totalFailed = 0;

  for (const file of files) {
    const kabCode = file.replace('_kecamatan.geojson', ''); // e.g. "3201"
    const kabInfo = kabMap[kabCode];
    const parentId = kabInfo ? kabInfo.id : null;

    if (!parentId && !DRY_RUN) {
      console.log(`   ⚠️  Skip ${file} — kabupaten ${kabCode} tidak ditemukan di DB`);
      continue;
    }

    const filePath = path.join(KEC_DIR, file);
    const geojson = readGeoJSON(filePath);
    const features = geojson.features.filter(f =>
      f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );

    let imported = 0;

    for (const feature of features) {
      const props = feature.properties;
      // Build kecamatan code: kd_propinsi(2) + kd_dati2(2) + kd_kecamatan(3) = 7 digits
      // e.g. "32" + "01" + "004" = "3201004"
      const provNum = props.kd_propinsi.padStart(2, '0');
      const kabNum  = props.kd_dati2.padStart(2, '0');
      const kecNum  = props.kd_kecamatan.padStart(3, '0');
      const code   = provNum + kabNum + kecNum;   // e.g. "3201004"
      const name   = props.nm_kecamatan || `Kecamatan ${kecNum}`;
      const geom   = ensureMultiPolygon(feature.geometry);

      const metadata = {
        kd_propinsi:  props.kd_propinsi,
        kd_dati2:     props.kd_dati2,
        kd_kecamatan: props.kd_kecamatan,
        source:       file
      };

      if (DRY_RUN) {
        kecMap[code] = { id: -1, name };
        imported++;
        continue;
      }

      try {
        const id = await upsertBoundary(client, {
          parentId, adminLevel: 'district', code, name, geom, metadata
        });
        kecMap[code] = { id, name };
        imported++;
      } catch (err) {
        totalFailed++;
        console.error(`     ❌ [${code}] ${name}: ${err.message}`);
      }
    }

    totalImported += imported;
    console.log(`   ✅ ${kabCode} (${kabInfo ? kabInfo.name : '?'}): ${imported} kecamatan`);
  }

  console.log(`   → Total: ${totalImported} kecamatan, ${totalFailed} failed`);
  return kecMap;
}

// ─── Step 4: Kelurahan / Desa ──────────────────────────────

async function importKelurahan(client, kecMap, kabMap) {
  console.log('\n── Step 4a: Kelurahan ──');

  if (!fs.existsSync(KEL_DIR)) {
    console.log(`   ⚠️  Folder tidak ditemukan: ${KEL_DIR}, skip`);
  } else {
    const files = fs.readdirSync(KEL_DIR).filter(f => f.endsWith('_kelurahan.geojson')).sort();
    console.log(`   📂 ${files.length} file kelurahan ditemukan`);

    let totalImported = 0;
    let totalFailed = 0;

    for (const file of files) {
      const kabCode = file.replace('_kelurahan.geojson', '');
      const filePath = path.join(KEL_DIR, file);
      const geojson = readGeoJSON(filePath);
      const features = geojson.features.filter(f =>
        f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
      );

      let imported = 0;

      for (const feature of features) {
        const props = feature.properties;

        // Build codes: kd_propinsi(2) + kd_dati2(2) + kd_kecamatan(3) + kd_kelurahan(3) = 10 digits
        // e.g. "32" + "01" + "024" + "011" = "3201024011"
        const provNum = props.kd_propinsi.padStart(2, '0');
        const kabNum  = props.kd_dati2.padStart(2, '0');
        const kecNum  = props.kd_kecamatan.padStart(3, '0');
        const kelNum  = props.kd_kelurahan.padStart(3, '0');
        const kecCode = provNum + kabNum + kecNum;       // e.g. "3201024"
        const code    = kecCode + kelNum;                // e.g. "3201024011"
        const name    = props.nm_kelurahan || `Kelurahan ${kelNum}`;
        const geom    = ensureMultiPolygon(feature.geometry);

        // Find parent kecamatan
        const kecInfo  = kecMap[kecCode];
        const parentId = kecInfo ? kecInfo.id : null;

        if (!parentId && !DRY_RUN) {
          // Try to find by querying DB
          totalFailed++;
          continue;
        }

        const metadata = {
          kd_propinsi:  props.kd_propinsi,
          kd_dati2:     props.kd_dati2,
          kd_kecamatan: props.kd_kecamatan,
          kd_kelurahan: props.kd_kelurahan,
          source:       file
        };

        if (DRY_RUN) {
          imported++;
          continue;
        }

        try {
          await upsertBoundary(client, {
            parentId, adminLevel: 'village', code, name, geom, metadata
          });
          imported++;
        } catch (err) {
          totalFailed++;
          if (totalFailed <= 5) {
            console.error(`     ❌ [${code}] ${name}: ${err.message}`);
          }
        }
      }

      totalImported += imported;
      const kabInfo = kabMap[kabCode];
      console.log(`   ✅ ${kabCode} (${kabInfo ? kabInfo.name : '?'}): ${imported} kelurahan`);
    }

    console.log(`   → Total kelurahan: ${totalImported}, failed: ${totalFailed}`);
  }

  // ── Step 4b: Desa ──
  console.log('\n── Step 4b: Desa ──');

  if (!fs.existsSync(DESA_FILE)) {
    console.log(`   ⚠️  File tidak ditemukan: ${DESA_FILE}, skip`);
    return;
  }

  const desaGeojson = readGeoJSON(DESA_FILE);
  const desaFeatures = desaGeojson.features.filter(f =>
    f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
  );
  console.log(`   📂 desa.geojson → ${desaFeatures.length} features`);

  let desaImported = 0;
  let desaFailed = 0;
  let desaSkipped = 0;
  let desaUpdated = 0;

  for (const feature of desaFeatures) {
    const props = feature.properties;
    const code  = props.KODE_DESA;        // e.g. "3201032011"
    const name  = props.DESA_KELUR || props.DESA || `Desa ${code}`;
    const geom  = ensureMultiPolygon(feature.geometry);

    if (!code) {
      desaSkipped++;
      continue;
    }

    // Parent kecamatan from KODE (6-digit kecamatan code)
    const kecCode6 = String(props.KODE);  // e.g. "320103"
    const kecInfo  = kecMap[kecCode6];
    const parentId = kecInfo ? kecInfo.id : null;

    const metadata = {
      OBJECT_ID:   props.OBJECT_ID,
      KODE:        props.KODE,
      PROVINSI:    props.PROVINSI,
      KAB_KOTA:    props.KAB_KOTA,
      KECAMATAN:   props.KECAMATAN,
      JUMLAH_PEN:  props.JUMLAH_PEN,
      JUMLAH_KK:   props.JUMLAH_KK,
      LUAS_WILAY:  props.LUAS_WILAY,
      source:      'desa.geojson'
    };

    if (DRY_RUN) {
      desaImported++;
      continue;
    }

    const spName = `sp_desa_${code.replace(/[^a-zA-Z0-9]/g, '_')}`;
    try {
      await client.query(`SAVEPOINT ${spName}`);

      // Check if already imported from kelurahan data — update metadata only (keep geometry from kelurahan)
      const existing = await client.query(
        'SELECT id FROM administrative_boundaries WHERE code = $1',
        [code]
      );

      if (existing.rows.length > 0) {
        // Merge desa metadata (population etc.) into existing kelurahan row
        await client.query(`
          UPDATE administrative_boundaries
          SET metadata = metadata || $1::jsonb,
              updated_at = NOW()
          WHERE code = $2
        `, [JSON.stringify(metadata), code]);
        desaUpdated++;
      } else {
        await upsertBoundary(client, {
          parentId, adminLevel: 'village', code, name, geom, metadata
        });
        desaImported++;
      }

      await client.query(`RELEASE SAVEPOINT ${spName}`);

      if ((desaImported + desaUpdated) % 500 === 0) {
        process.stdout.write(`   ✔ ${desaImported} new + ${desaUpdated} updated...\r`);
      }
    } catch (err) {
      try { await client.query(`ROLLBACK TO SAVEPOINT ${spName}`); } catch (_) {}
      desaFailed++;
      if (desaFailed <= 10) {
        console.error(`     ❌ [${code}] ${name}: ${err.message}`);
      }
    }
  }

  console.log(`   → Desa: ${desaImported} new, ${desaUpdated} updated, ${desaFailed} failed, ${desaSkipped} skipped`);
}

// ─── Step 5: Update province geometry ──────────────────────

async function updateProvinceGeometry(client, provinceId) {
  console.log('\n── Step 5: Update province geometry (ST_Union of all kab/kota) ──');

  if (DRY_RUN) {
    console.log('   [DRY] skip');
    return;
  }

  await client.query(`
    UPDATE administrative_boundaries
    SET geom = (
      SELECT ST_Multi(ST_Union(geom))
      FROM administrative_boundaries
      WHERE parent_id = $1 AND is_active = TRUE
    ),
    updated_at = NOW()
    WHERE id = $1
  `, [provinceId]);

  console.log('   ✅ Province geometry updated');
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Import Boundary Jawa Barat (BPS Data)');
  console.log('  Jabar_By_Kab + Kecamatan + Kelurahan + Desa');
  console.log('═══════════════════════════════════════════════════════');

  if (DRY_RUN) console.log('\n🧪 DRY RUN MODE — tidak ada data yang disimpan\n');
  if (SKIP_KECAMATAN) console.log('⏭️  Skip kecamatan + kelurahan/desa\n');
  else if (SKIP_VILLAGE) console.log('⏭️  Skip kelurahan/desa\n');

  let client;
  if (!DRY_RUN) {
    client = await pool.connect();
    console.log('✅ Connected to PostGIS');
  } else {
    // Dummy client for dry-run (no DB needed)
    client = { query: async () => ({ rows: [] }) };
    console.log('✅ Dry-run mode — no DB connection needed');
  }

  const startTime = Date.now();

  try {
    if (!DRY_RUN) {
      // ALTER TYPE ... ADD VALUE cannot run inside a transaction block
      // so we do it before BEGIN
      try {
        await client.query("ALTER TYPE admin_level_enum ADD VALUE IF NOT EXISTS 'village'");
        console.log('   ✅ Enum village ditambahkan');
      } catch (e) {
        // Already exists — ignore
        console.log('   ℹ️  Enum village sudah ada');
      }

      await client.query('BEGIN');

      // Clear previous data
      console.log('\n🗑️  Menghapus data boundary lama...');
      await client.query('DELETE FROM boundary_split_history');
      await client.query('DELETE FROM administrative_boundaries');
      await client.query("SELECT setval('administrative_boundaries_id_seq', 1, false)");
    }

    // Step 1: Province
    const provinceId = await importProvince(client);

    // Step 2: Kabupaten/Kota
    const kabMap = await importKabupaten(client, provinceId);

    // Step 3: Kecamatan
    let kecMap = {};
    if (!SKIP_KECAMATAN) {
      kecMap = await importKecamatan(client, kabMap);
    }

    // Step 4: Kelurahan + Desa
    if (!SKIP_KECAMATAN && !SKIP_VILLAGE) {
      await importKelurahan(client, kecMap, kabMap);
    }

    // Step 5: Update province geometry
    if (!DRY_RUN) {
      await updateProvinceGeometry(client, provinceId);
    }

    if (!DRY_RUN) {
      await client.query('COMMIT');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // ── Summary ──
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  IMPORT SELESAI');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  ⏱️  Waktu: ${elapsed} detik`);

    if (!DRY_RUN) {
      const summary = await client.query(`
        SELECT admin_level, COUNT(*) as count
        FROM administrative_boundaries
        WHERE is_active = TRUE
        GROUP BY admin_level
        ORDER BY admin_level
      `);
      console.log('\n  📊 Data di database:');
      summary.rows.forEach(r => {
        console.log(`     ${r.admin_level.padEnd(10)} : ${r.count} wilayah`);
      });

      const areaResult = await client.query(`
        SELECT SUM(area_km2) as total_area
        FROM administrative_boundaries
        WHERE admin_level = 'city' AND is_active = TRUE
      `);
      if (areaResult.rows[0].total_area) {
        console.log(`\n  🗺️  Total luas Kab/Kota: ${Math.round(areaResult.rows[0].total_area)} km²`);
      }
    }

  } catch (err) {
    if (!DRY_RUN) await client.query('ROLLBACK');
    console.error('\n❌ Import gagal, ROLLBACK:', err.message);
    throw err;
  } finally {
    if (!DRY_RUN) {
      client.release();
    }
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
