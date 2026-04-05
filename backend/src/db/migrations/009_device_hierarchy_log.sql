-- ============================================
-- 009: Device Hierarchy History Log
-- Tracks temporal changes to parent-child
-- relationships (downstream / phase_channel)
-- for accurate historical analytics
-- ============================================

CREATE TABLE IF NOT EXISTS device_hierarchy_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    parent_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    parent_relation VARCHAR(20),          -- 'downstream' | 'phase_channel' | NULL (= detached)
    phase_channel   VARCHAR(5),           -- 'L1' | 'L2' | 'L3' | NULL
    action          VARCHAR(10) NOT NULL CHECK (action IN ('attached', 'detached')),
    timestamp       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dhl_device ON device_hierarchy_log(device_id);
CREATE INDEX IF NOT EXISTS idx_dhl_parent ON device_hierarchy_log(parent_device_id);
CREATE INDEX IF NOT EXISTS idx_dhl_device_time ON device_hierarchy_log(device_id, timestamp);

-- Seed initial state from current hierarchy (so existing relationships have history)
INSERT INTO device_hierarchy_log (device_id, parent_device_id, parent_relation, phase_channel, action, timestamp)
SELECT id, parent_device_id, parent_relation, phase_channel, 'attached', created_at
FROM devices
WHERE parent_device_id IS NOT NULL;
