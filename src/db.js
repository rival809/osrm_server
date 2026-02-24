/**
 * PostGIS Database Connection Pool
 * Connects to the osrm-postgres container on the osrm-network.
 */
const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  host: process.env.PGHOST || 'postgres',        // Docker service name
  port: parseInt(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'nominatim',
  user: process.env.PGUSER || 'nominatim',
  password: process.env.PGPASSWORD || 'nominatim123',
  max: parseInt(process.env.PG_POOL_MAX) || 10,  // max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,                       // 30s query timeout
});

// Log pool events
pool.on('connect', () => {
  logger.debug('PostGIS pool: new client connected');
});

pool.on('error', (err) => {
  logger.error('PostGIS pool unexpected error', { error: err.message });
});

/**
 * Health check — verifies PostGIS is reachable and has the spatial extension.
 */
async function checkHealth() {
  try {
    const { rows } = await pool.query('SELECT PostGIS_Version() AS version');
    return { status: 'ok', postgis: rows[0].version };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

module.exports = { pool, checkHealth };
