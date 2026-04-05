-- ============================================
-- 004: Device Hierarchy
-- Adds device_role, parent_device_id, parent_relation, phase_channel
-- Supports: general meter identification, phase sub-devices, downstream loads
-- ============================================

-- 1. Device role: formal identification of general meter
ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_role VARCHAR(20) DEFAULT 'sub_meter';

-- 2. Parent-child relationships (phase channels & downstream loads)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS parent_device_id UUID REFERENCES devices(id) ON DELETE SET NULL;

-- 3. Type of parent relationship
-- 'phase_channel': virtual sub-device reading L1/L2/L3 from parent
-- 'downstream': separate meter, parent's reading includes this device
ALTER TABLE devices ADD COLUMN IF NOT EXISTS parent_relation VARCHAR(20);

-- 4. Which phase channel this sub-device reads (only for phase_channel relation)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS phase_channel VARCHAR(2);

-- Fix existing data: set Contador General by name (one-time migration)
UPDATE devices SET device_role = 'general_meter'
WHERE LOWER(name) LIKE '%contador%general%'
  AND device_role IS DISTINCT FROM 'general_meter';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_devices_parent ON devices(parent_device_id);
CREATE INDEX IF NOT EXISTS idx_devices_role ON devices(device_role);

-- Constraints
ALTER TABLE devices ADD CONSTRAINT chk_parent_relation
    CHECK (parent_relation IS NULL OR parent_relation IN ('phase_channel', 'downstream'));

ALTER TABLE devices ADD CONSTRAINT chk_phase_channel
    CHECK (phase_channel IS NULL OR phase_channel IN ('L1', 'L2', 'L3'));

ALTER TABLE devices ADD CONSTRAINT chk_phase_requires_parent
    CHECK (phase_channel IS NULL OR parent_device_id IS NOT NULL);
