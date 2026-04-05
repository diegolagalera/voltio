/**
 * FPSaver — Migration 003
 * Cost snapshots hypertable + factory comunidad_autonoma
 *
 * Run: PGPASSWORD=fpsaver_secret_2026 psql -h localhost -U fpsaver_admin -d fpsaver -f backend/src/db/migrations/003_cost_history.sql
 */

-- ═══════════════════════════════════════════
-- 1. Cost Snapshots (hourly cost history)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cost_snapshots (
    id UUID DEFAULT gen_random_uuid(),
    factory_id UUID NOT NULL REFERENCES factories(id),
    contract_id UUID NOT NULL REFERENCES contracts(id),
    timestamp TIMESTAMPTZ NOT NULL,
    period TEXT NOT NULL,           -- P1, P2, ... P6
    price_kwh NUMERIC(10,6) NOT NULL,
    price_kwh_no_tax NUMERIC(10,6),
    kwh_consumed NUMERIC(12,4) DEFAULT 0,
    cost_eur NUMERIC(12,4) DEFAULT 0,
    pricing_model TEXT,             -- fixed, indexed_omie, pvpc
    spot_price NUMERIC(10,6),       -- OMIE/PVPC spot price (when indexed)
    breakdown JSONB,                -- Full cost breakdown snapshot
    created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('cost_snapshots', 'timestamp', if_not_exists => true);
CREATE INDEX IF NOT EXISTS idx_cost_snapshots_factory ON cost_snapshots (factory_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cost_snapshots_contract ON cost_snapshots (contract_id, timestamp DESC);

-- ═══════════════════════════════════════════
-- 2. Factory Comunidad Autónoma
-- ═══════════════════════════════════════════

ALTER TABLE factories ADD COLUMN IF NOT EXISTS comunidad_autonoma VARCHAR(50) DEFAULT 'nacional';

COMMENT ON COLUMN factories.comunidad_autonoma IS 'Comunidad autónoma for regional holiday filtering';
