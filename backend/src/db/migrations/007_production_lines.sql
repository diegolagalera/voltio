-- ============================================
-- 007: Production Lines
-- Enables grouping devices into production lines
-- with temporal membership tracking for accurate
-- historical cost/energy analytics
-- ============================================

-- 1. Production Lines (main entity)
CREATE TABLE IF NOT EXISTS production_lines (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    factory_id      UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    color           VARCHAR(7) DEFAULT '#8b5cf6',
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pl_factory ON production_lines(factory_id);
CREATE INDEX IF NOT EXISTS idx_pl_active ON production_lines(factory_id, is_active);

-- 2. Current membership (fast lookup for real-time views)
CREATE TABLE IF NOT EXISTS production_line_devices (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_line_id  UUID NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    device_id           UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    added_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(production_line_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_pld_line ON production_line_devices(production_line_id);
CREATE INDEX IF NOT EXISTS idx_pld_device ON production_line_devices(device_id);

-- 3. Membership log (temporal history — append-only)
CREATE TABLE IF NOT EXISTS production_line_membership_log (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_line_id  UUID NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    device_id           UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    action              VARCHAR(10) NOT NULL CHECK (action IN ('added', 'removed')),
    timestamp           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plml_line ON production_line_membership_log(production_line_id);
CREATE INDEX IF NOT EXISTS idx_plml_line_time ON production_line_membership_log(production_line_id, timestamp);

-- Apply updated_at trigger
CREATE TRIGGER trigger_production_lines_updated_at
    BEFORE UPDATE ON production_lines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
