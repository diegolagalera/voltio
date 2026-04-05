-- ============================================
-- Migration: Add MQTT credentials to factories
-- ============================================

ALTER TABLE factories ADD COLUMN IF NOT EXISTS mqtt_username VARCHAR(100) UNIQUE;
ALTER TABLE factories ADD COLUMN IF NOT EXISTS mqtt_password_hash VARCHAR(255);
ALTER TABLE factories ADD COLUMN IF NOT EXISTS mqtt_password_encrypted TEXT;

-- Set mqtt_username for existing factories that don't have one
UPDATE factories
SET mqtt_username = 'fac_' || LEFT(id::text, 8)
WHERE mqtt_username IS NULL;

-- Set mqtt_topic for existing factories that don't have one
UPDATE factories
SET mqtt_topic = 'factory/' || id::text
WHERE mqtt_topic IS NULL;
