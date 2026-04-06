/**
 * Add phone and contact_email columns to companies table.
 * These fields are used by the superadmin company creation/update forms.
 * Idempotent: uses IF NOT EXISTS to safely re-run.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE companies DROP COLUMN IF EXISTS phone;
        ALTER TABLE companies DROP COLUMN IF EXISTS contact_email;
    `);
};
