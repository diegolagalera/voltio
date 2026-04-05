-- Migration 009: System Notifications (Incident-based model)
-- Stores automated system event notifications with open/resolve lifecycle
-- Run: docker exec -i fpsaver_postgres psql -U fpsaver_admin -d fpsaver -f /dev/stdin < backend/src/db/migrations/009_system_notifications.sql

CREATE TABLE IF NOT EXISTS system_notifications (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    factory_id       UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    device_id        UUID REFERENCES devices(id) ON DELETE SET NULL,
    event_type       VARCHAR(50) NOT NULL,
    severity         VARCHAR(20) NOT NULL DEFAULT 'warning',
    status           VARCHAR(20) NOT NULL DEFAULT 'active',
    title            TEXT NOT NULL,
    message          TEXT NOT NULL,
    metadata         JSONB DEFAULT '{}',
    occurrence_count INT DEFAULT 1,
    first_seen_at    TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at     TIMESTAMPTZ DEFAULT NOW(),
    resolved_at      TIMESTAMPTZ,
    is_read          BOOLEAN DEFAULT false,
    read_by          UUID REFERENCES users(id),
    read_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sn_factory ON system_notifications(factory_id);
CREATE INDEX IF NOT EXISTS idx_sn_factory_unread ON system_notifications(factory_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_sn_active ON system_notifications(factory_id, event_type, device_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sn_created ON system_notifications(created_at DESC);
