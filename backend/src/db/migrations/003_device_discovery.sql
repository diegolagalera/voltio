-- ============================================
-- 003: Device Discovery
-- Adds discovered_devices table for auto-discovery via network scan
-- ============================================

-- Table for storing discovered (pending) devices from network scans
CREATE TABLE IF NOT EXISTS discovered_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    ip_address VARCHAR(45) NOT NULL,
    port INTEGER DEFAULT 502,
    modbus_address INTEGER DEFAULT 1,
    detected_model VARCHAR(50),
    detected_type VARCHAR(20) CHECK (detected_type IN ('trifasica', 'monofasica', 'master')),
    voltage_sample DECIMAL(10,2),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'ignored')),
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    confirmed_by UUID REFERENCES users(id),
    device_id UUID REFERENCES devices(id),
    UNIQUE(factory_id, ip_address)
);

-- Add IP-based fields to devices table
ALTER TABLE devices ADD COLUMN IF NOT EXISTS host VARCHAR(45);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS port INTEGER DEFAULT 502;

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_discovered_devices_factory
    ON discovered_devices(factory_id, status);
