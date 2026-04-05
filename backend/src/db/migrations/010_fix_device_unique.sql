-- ============================================
-- 010: Fix Device Unique Constraint
-- The old UNIQUE(factory_id, modbus_address) prevents multiple meters
-- with the same modbus_address on different IPs (each USR-TCP232 adapter
-- has its own IP but meters all default to modbus_address=1).
-- Fix: UNIQUE(factory_id, host, modbus_address)
-- ============================================

-- Drop old constraint (may not exist depending on DB state)
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_factory_id_modbus_address_key;

-- Drop old unique index (created in hierarchy migration)
DROP INDEX IF EXISTS idx_devices_factory_modbus_unique;

-- Add new constraint including host
ALTER TABLE devices ADD CONSTRAINT devices_factory_host_modbus_unique
    UNIQUE(factory_id, host, modbus_address);
