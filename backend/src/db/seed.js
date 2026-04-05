/**
 * FPSaver - Database Seed Script
 * Creates the initial SuperAdmin user
 * Run: node src/db/seed.js
 */
const db = require('../config/database');
const { hash } = require('../utils/password');
const config = require('../config/env');

const seed = async () => {
    console.log('[SEED] Starting database seed...');

    try {
        // Check if superadmin already exists
        const existing = await db.query(
            "SELECT id FROM users WHERE role = 'superadmin' LIMIT 1"
        );

        if (existing.rows.length > 0) {
            console.log('[SEED] SuperAdmin already exists, skipping.');
            process.exit(0);
        }

        // Create SuperAdmin
        const passwordHash = await hash(config.superadmin.password);

        const result = await db.query(
            `INSERT INTO users (company_id, email, password_hash, first_name, last_name, role)
       VALUES (NULL, $1, $2, 'Super', 'Admin', 'superadmin')
       RETURNING id, email, role`,
            [config.superadmin.email, passwordHash]
        );

        console.log('[SEED] SuperAdmin created:', result.rows[0]);
        console.log('[SEED] Email:', config.superadmin.email);
        console.log('[SEED] Password:', config.superadmin.password);
        console.log('[SEED] Done!');
        process.exit(0);
    } catch (err) {
        console.error('[SEED] Error:', err.message);
        process.exit(1);
    }
};

seed();
