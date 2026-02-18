/**
 * Import Boundary Jawa Barat dari jabar.json
 *
 * File: data/boundaries/jabar.json
 * Format: GeoJSON FeatureCollection — "Jabar_By_Kab"
 * Properties:  OBJECTID, PROVINSI, PROVNO, KABKOTNO, KABKOT, ID_KAB
 * Geometry:    MultiPolygon (CRS84 / EPSG:4326)
 *
 * Mapping ke schema administrative_boundaries:
 *   - Province "JAWA BARAT" (code "32") di-insert dulu sebagai parent
 *   - Setiap feature → admin_level='city', code=ID_KAB, name=KABKOT
 *
 * Usage:
 *   PGHOST=localhost node scripts/import-jabar.js
 *   docker exec osrm-tile-service node scripts/import-jabar.js
 *
 * Env vars:
 *   DRY_RUN=1   — Preview tanpa insert ke DB
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ─── Config ────────────────────────────────────────────────
const GEOJSON_PATH = path.join(__dirname, '..', 'data', 'boundaries', 'jabar.json');

const pool = new Pool({
  host: process.env.PGHOST || 'postgres',
  port: parseInt(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'nominatim',
  user: process.env.PGUSER || 'nominatim',
  password: process.env.PGPASSWORD || 'nominatim123',
  connectionTimeoutMillis: 10000,
});

const DRY_RUN = process.env.DRY_RUN === '1';

// ─── Main ──────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Import Boundary Jawa Barat (jabar.json)');
  console.log('═══════════════════════════════════════════');

  // Read GeoJSON
  if (!fs.existsSync(GEOJSON_PATH)) {
    console.error(`❌ File tidak ditemukan: ${GEOJSON_PATH}`);
    console.error('   Pastikan jabar.json ada di data/boundaries/');
    process.exit(1);
  }

  console.log(`📂 Membaca ${GEOJSON_PATH} ...`);
  const raw = fs.readFileSync(GEOJSON_PATH, 'utf8');
  const geojson = JSON.parse(raw);

  if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    console.error('❌ File bukan valid GeoJSON FeatureCollection');
    process.exit(1);
  }

  const features = geojson.features;
  console.log(`📊 Total features: ${features.length}`);

  // Validate geometry types
  const geomTypes = [...new Set(features.map(f => f.geometry?.type))];
  console.log(`📐 Geometry types: ${geomTypes.join(', ')}`);

  const polyFeatures = features.filter(f =>
    f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'
  );

  if (polyFeatures.length === 0) {
    console.error('❌ Tidak ada fitur Polygon/MultiPolygon');
    process.exit(1);
  }

  // Preview features
  console.log('\n┌─────┬──────────┬────────────────────────────────────────────┐');
  console.log('│ No  │ ID_KAB   │ KABKOT                                     │');
  console.log('├─────┼──────────┼────────────────────────────────────────────┤');
  polyFeatures.forEach((f, i) => {
    const p = f.properties;
    const no = String(i + 1).padStart(3);
    const id = (p.ID_KAB || '?').padEnd(8);
    const name = (p.KABKOT || '?').padEnd(42);
    console.log(`│ ${no} │ ${id} │ ${name} │`);
  });
  console.log('└─────┴──────────┴────────────────────────────────────────────┘');

  if (DRY_RUN) {
    console.log('\n🔍 DRY_RUN mode — tidak ada data yang di-insert.');
    process.exit(0);
  }

  // Connect to database
  const client = await pool.connect();
  console.log('\n✅ Connected to PostGIS');

  try {
    await client.query('BEGIN');

    // ── Step 1: Ensure province "JAWA BARAT" exists ──
    console.log('\n── Step 1: Insert/update province Jawa Barat ──');
    const provinceCode = '32';
    const provinceName = 'JAWA BARAT';

    // Create a bounding polygon for the province from all city features
    // We'll update the province geometry after importing all cities (ST_Union)

    const provResult = await client.query(`
      INSERT INTO administrative_boundaries (admin_level, code, name, geom, metadata)
      VALUES (
        'province',
        $1,
        $2,
        ST_SetSRID(ST_GeomFromGeoJSON($3), 4326),
        $4::jsonb
      )
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING id
    `, [
      provinceCode,
      provinceName,
      // Temporary empty geometry — will be replaced with union
      JSON.stringify({ type: 'MultiPolygon', coordinates: [[[[106.0, -6.0], [108.0, -6.0], [108.0, -8.0], [106.0, -8.0], [106.0, -6.0]]]] }),
      JSON.stringify({ PROVNO: provinceCode, source: 'jabar.json' })
    ]);

    const provinceId = provResult.rows[0].id;
    console.log(`   ✅ Province "${provinceName}" → id=${provinceId}`);

    // ── Step 2: Import cities ──
    console.log('\n── Step 2: Import Kota/Kabupaten ──');
    let imported = 0;
    let failed = 0;

    for (const feature of polyFeatures) {
      const props = feature.properties;
      const code = props.ID_KAB || `OBJ_${props.OBJECTID}`;
      const name = props.KABKOT || `Unknown #${props.OBJECTID}`;

      // Normalize geometry to MultiPolygon
      let geomJson = feature.geometry;
      if (geomJson.type === 'Polygon') {
        geomJson = {
          type: 'MultiPolygon',
          coordinates: [geomJson.coordinates]
        };
      }

      const metadata = {
        OBJECTID: props.OBJECTID,
        KABKOTNO: props.KABKOTNO,
        PROVNO: props.PROVNO,
        source: 'jabar.json'
      };

      try {
        await client.query(`
          INSERT INTO administrative_boundaries (parent_id, admin_level, code, name, geom, metadata)
          VALUES (
            $1,
            'city',
            $2,
            $3,
            ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
            $5::jsonb
          )
          ON CONFLICT (code) DO UPDATE SET
            parent_id = EXCLUDED.parent_id,
            name = EXCLUDED.name,
            geom = ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        `, [
          provinceId,
          code,
          name,
          JSON.stringify(geomJson),
          JSON.stringify(metadata)
        ]);

        imported++;
        console.log(`   ✅ [${imported}/${polyFeatures.length}] ${code} — ${name}`);
      } catch (err) {
        failed++;
        console.error(`   ❌ [${code}] ${name}: ${err.message}`);
      }
    }

    // ── Step 3: Update province geometry using ST_Union of all cities ──
    console.log('\n── Step 3: Update province geometry (ST_Union of all cities) ──');
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

    await client.query('COMMIT');

    // ── Summary ──
    console.log('\n═══════════════════════════════════════════');
    console.log('  IMPORT SELESAI');
    console.log('═══════════════════════════════════════════');
    console.log(`  ✅ Imported: ${imported} kota/kabupaten`);
    if (failed > 0) console.log(`  ❌ Failed:   ${failed}`);
    console.log(`  🗺️  Province: ${provinceName} (code=${provinceCode})`);

    // Verify count
    const countResult = await client.query(`
      SELECT admin_level, COUNT(*) as cnt
      FROM administrative_boundaries
      WHERE is_active = TRUE
      GROUP BY admin_level
      ORDER BY admin_level
    `);
    console.log('\n  Data di database:');
    countResult.rows.forEach(r => {
      console.log(`    ${r.admin_level}: ${r.cnt}`);
    });

    // Verify total area
    const areaResult = await client.query(`
      SELECT SUM(area_km2) as total_area
      FROM administrative_boundaries
      WHERE admin_level = 'city' AND parent_id = $1 AND is_active = TRUE
    `, [provinceId]);
    console.log(`\n  Total luas Kab/Kota: ${Math.round(areaResult.rows[0].total_area)} km²`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Import gagal, ROLLBACK:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
