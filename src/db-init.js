/**
 * Database Initializer
 * Runs the SQL migration files against the PostGIS database.
 * Use this when the postgres volume already existed before the SQL scripts were added.
 *
 * Usage:
 *   node src/db-init.js
 *   # or from Docker:
 *   docker exec osrm-tile-service node src/db-init.js
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'postgres',
  port: parseInt(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'nominatim',
  user: process.env.PGUSER || 'nominatim',
  password: process.env.PGPASSWORD || 'nominatim123',
  connectionTimeoutMillis: 10000,
});

async function run() {
  const sqlDir = path.join(__dirname, '..', 'sql');
  const files = fs.readdirSync(sqlDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} SQL files to execute.\n`);

  const client = await pool.connect();
  try {
    for (const file of files) {
      const filePath = path.join(sqlDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`▶ Executing ${file} ...`);
      await client.query(sql);
      console.log(`  ✔ ${file} done.\n`);
    }
    console.log('✅ Database initialization complete.');
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
