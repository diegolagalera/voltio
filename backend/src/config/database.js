const { Pool } = require('pg');
const config = require('./env');

const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    statement_timeout: 10000,       // 10s max per query
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle client:', err.message);
    // Don't exit — the pool will recover by creating new connections
});

pool.on('connect', async (client) => {
    try { await client.query("SET timezone = 'Europe/Madrid'"); } catch (e) { /* ignore */ }
    console.log('[DB] New client connected to PostgreSQL');
});

/**
 * Execute a query with parameters
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
const query = async (text, params) => {
    const start = Date.now();
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 100) {
        console.warn(`[DB] Slow query (${duration}ms):`, text.substring(0, 80));
    }
    return result;
};

/**
 * Get a client from the pool for transactions
 * @returns {Promise<import('pg').PoolClient>}
 */
const getClient = async () => {
    return pool.connect();
};

module.exports = { pool, query, getClient };
