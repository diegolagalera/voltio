-- Migration: Add hierarchy context to telemetry hypertable
-- This denormalizes parent_device_id and parent_relation into each telemetry row
-- so historical reports can reconstruct the device hierarchy at any point in time.

ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS parent_device_id UUID;
ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS parent_relation VARCHAR(20);

-- Index for efficient hierarchy-aware queries
CREATE INDEX IF NOT EXISTS idx_telemetry_parent 
    ON telemetry (parent_device_id, time DESC) 
    WHERE parent_device_id IS NOT NULL;

COMMENT ON COLUMN telemetry.parent_device_id IS 'Snapshot of device parent at write time for historical hierarchy reconstruction';
COMMENT ON COLUMN telemetry.parent_relation IS 'Snapshot of parent_relation (phase_channel, downstream) at write time';
