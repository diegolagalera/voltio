-- ============================================
-- FPSaver - Seed Data
-- Creates the initial SuperAdmin user
-- ============================================

-- Insert SuperAdmin user
-- Password: SuperAdmin2026! (bcrypt hash)
-- Generate with: node -e "const bcrypt = require('bcrypt'); bcrypt.hash('SuperAdmin2026!', 12).then(h => console.log(h))"
INSERT INTO users (id, company_id, email, password_hash, first_name, last_name, role)
VALUES (
    uuid_generate_v4(),
    NULL,
    'admin@fpsaver.com',
    '$2b$12$placeholder_hash_replace_on_first_run',
    'Super',
    'Admin',
    'superadmin'
) ON CONFLICT (email) DO NOTHING;
