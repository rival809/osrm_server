/**
 * rollback-district-codes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Restores district_boundaries from a backup table created by
 * migrate-district-codes.js.
 *
 * Usage:
 *   node scripts/rollback-district-codes.js <backup_table_name>
 *   node scripts/rollback-district-codes.js district_boundaries_backup_1708413600000
 *
 * Docker:
 *   docker exec osrm-tile-service node scripts/rollback-district-codes.js <backup_table>
 *
 * To list available backups:
 *   node scripts/rollback-district-codes.js --list
 */

'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.PGHOST     || 'postgres',
  port:     parseInt(process.env.PGPORT)  || 5432,
  database: process.env.PGDATABASE || 'nominatim',
  user:     process.env.PGUSER     || 'nominatim',
  password: process.env.PGPASSWORD || 'nominatim123',
  connectionTimeoutMillis: 15000,
  statement_timeout: 120000,
});

async function listBackups(client) {
  const { rows } = await client.query(`
    SELECT tablename,
           pg_size_pretty(pg_total_relation_size(quote_ident(tablename))) AS size
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE 'district_boundaries_backup_%'
    ORDER BY tablename DESC
  `);
  if (!rows.length) {
    console.log('Tidak ada backup table yang ditemukan.');
  } else {
    console.log('Backup tables tersedia:\n');
    rows.forEach(r => console.log(`  ${r.tablename}  (${r.size})`));
    console.log(`\nUsage: node scripts/rollback-district-codes.js <tablename>`);
  }
}

async function main() {
  const arg = process.argv[2];

  const client = await pool.connect();
  try {
    if (!arg || arg === '--list') {
      await listBackups(client);
      return;
    }

    const backupTable = arg.trim();

    // Validate backup table exists
    const { rows } = await client.query(`
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = $1
    `, [backupTable]);

    if (!rows.length) {
      console.error(`❌ Backup table tidak ditemukan: "${backupTable}"`);
      console.error('   Jalankan --list untuk melihat backup yang tersedia.');
      process.exit(1);
    }

    const { rows: countRows } = await client.query(`SELECT COUNT(*) AS n FROM ${backupTable}`);
    console.log(`\n🔁 Rollback dari: ${backupTable} (${countRows[0].n} rows)\n`);

    await client.query('BEGIN');

    // 1. Restore unique index to old single-column if it exists
    //    (no-op if already exists or already composite)
    await client.query(`DROP INDEX IF EXISTS uq_district_boundaries_p3d_district`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_district_boundaries_district_id
        ON district_boundaries (district_id)
    `).catch(() => {
      // If duplicate district_id exists in restored data, skip re-creating old index
      console.warn('⚠️  Tidak bisa restore index uq_district_boundaries_district_id (mungkin ada duplicate). Index composite dipertahankan.');
    });

    // 2. Copy backup → district_boundaries (truncate + insert)
    await client.query(`TRUNCATE district_boundaries RESTART IDENTITY CASCADE`);
    await client.query(`INSERT INTO district_boundaries SELECT * FROM ${backupTable}`);

    await client.query('COMMIT');

    console.log(`✅ Rollback berhasil. district_boundaries dipulihkan dari ${backupTable}.`);
    console.log(`\n   Backup table "${backupTable}" masih ada. Hapus manual jika sudah tidak diperlukan:`);
    console.log(`   DROP TABLE ${backupTable};\n`);

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
