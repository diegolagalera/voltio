#!/usr/bin/env node
/**
 * Voltio — Migration Runner
 * Wraps node-pg-migrate with project env vars
 *
 * Usage:
 *   node src/db/migrate.js up          — apply pending migrations
 *   node src/db/migrate.js down        — rollback last migration
 *   node src/db/migrate.js redo        — down + up last migration
 *   node src/db/migrate.js create name — create a new migration
 */
const { execSync } = require('child_process');
const path = require('path');

// Load .env from project root (local dev) — in Docker, env vars are injected directly
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
// Also try local .env (for running from backend/)
require('dotenv').config();

// ── Build DATABASE_URL from individual env vars ──────────
const user     = process.env.POSTGRES_USER     || 'fpsaver_admin';
const password = encodeURIComponent(process.env.POSTGRES_PASSWORD || '');
const host     = process.env.POSTGRES_HOST     || 'localhost';
const port     = process.env.POSTGRES_PORT     || '5432';
const db       = process.env.POSTGRES_DB       || 'fpsaver';

const DATABASE_URL = `postgresql://${user}:${password}@${host}:${port}/${db}`;

// ── Resolve paths ────────────────────────────────────────
const migrationsDir = path.join(__dirname, 'migrations');
const pgMigrateBin  = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'node-pg-migrate');

// ── Build command ────────────────────────────────────────
const args = process.argv.slice(2).join(' ') || 'up';
const cmd  = `"${pgMigrateBin}" ${args} --migrations-dir "${migrationsDir}" --migrations-table pgmigrations`;

console.log(`[MIGRATE] Running: node-pg-migrate ${args}`);
console.log(`[MIGRATE] Migrations dir: ${migrationsDir}`);
console.log(`[MIGRATE] Database: ${db}@${host}:${port}`);
console.log('');

try {
    execSync(cmd, {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL },
    });
} catch (err) {
    process.exit(1);
}
