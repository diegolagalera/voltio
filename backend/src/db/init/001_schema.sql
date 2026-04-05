-- ============================================
-- FPSaver - Database Schema
-- PostgreSQL 16 + TimescaleDB + pgvector
-- ============================================

-- ============================================
-- 1. Extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- 2. ENUM Types
-- ============================================
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('superadmin', 'manager', 'gerencia', 'operador');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE device_type AS ENUM ('monofasica', 'trifasica', 'master');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE alarm_severity AS ENUM ('info', 'warning', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE alarm_type AS ENUM (
        'overvoltage', 'undervoltage', 'overcurrent',
        'low_power_factor', 'overdemand', 'device_offline',
        'frequency_deviation', 'energy_threshold'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 3. Companies (Tenants)
-- ============================================
CREATE TABLE IF NOT EXISTS companies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    tax_id          VARCHAR(50) UNIQUE,
    address         TEXT,
    city            VARCHAR(100),
    country         VARCHAR(100) DEFAULT 'España',
    timezone        VARCHAR(50) DEFAULT 'Europe/Madrid',
    logo_url        VARCHAR(500),
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_companies_active ON companies(is_active);

-- ============================================
-- 4. Users
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID REFERENCES companies(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    role            user_role NOT NULL DEFAULT 'operador',
    phone           VARCHAR(20),
    is_active       BOOLEAN DEFAULT true,
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- SuperAdmin has company_id = NULL
CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================
-- 5. Refresh Tokens (for JWT rotation)
-- ============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL,
    jti             VARCHAR(255) NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    is_revoked      BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_jti ON refresh_tokens(jti);

-- ============================================
-- 6. Factories
-- ============================================
CREATE TABLE IF NOT EXISTS factories (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    location_address TEXT,
    city            VARCHAR(100),
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    timezone        VARCHAR(50) DEFAULT 'Europe/Madrid',
    mqtt_topic      VARCHAR(255) UNIQUE,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_factories_company ON factories(company_id);
CREATE INDEX idx_factories_active ON factories(is_active);

-- ============================================
-- 7. User-Factory Access (RBAC Matrix)
-- ============================================
CREATE TABLE IF NOT EXISTS user_factory_access (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    factory_id      UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    granted_at      TIMESTAMPTZ DEFAULT NOW(),
    granted_by      UUID REFERENCES users(id),
    UNIQUE(user_id, factory_id)
);

CREATE INDEX idx_ufa_user ON user_factory_access(user_id);
CREATE INDEX idx_ufa_factory ON user_factory_access(factory_id);

-- ============================================
-- 8. Devices (Carlo Gavazzi Meters)
-- ============================================
CREATE TABLE IF NOT EXISTS devices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    factory_id      UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    serial_number   VARCHAR(100),
    device_type     device_type NOT NULL DEFAULT 'trifasica',
    modbus_address  INTEGER NOT NULL DEFAULT 1,
    model           VARCHAR(100) DEFAULT 'EM340',
    description     TEXT,
    metadata        JSONB DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(factory_id, modbus_address)
);

CREATE INDEX idx_devices_factory ON devices(factory_id);
CREATE INDEX idx_devices_active ON devices(is_active);
CREATE INDEX idx_devices_type ON devices(device_type);

-- ============================================
-- 9. Contracts (Electrical Tariffs)
-- ============================================
CREATE TABLE IF NOT EXISTS contracts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    factory_id          UUID REFERENCES factories(id) ON DELETE SET NULL,
    provider            VARCHAR(255) NOT NULL,
    contract_number     VARCHAR(100),
    contracted_power_kw DOUBLE PRECISION,
    price_kwh_default   DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    -- Tariff periods (P1-P6 Spanish model)
    -- Format: { "P1": { "price_kwh": 0.25, "hours": "10-14,18-22" }, ... }
    tariff_periods      JSONB DEFAULT '{}',
    currency            VARCHAR(3) DEFAULT 'EUR',
    start_date          DATE NOT NULL,
    end_date            DATE,
    is_active           BOOLEAN DEFAULT true,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contracts_company ON contracts(company_id);
CREATE INDEX idx_contracts_factory ON contracts(factory_id);

-- ============================================
-- 10. Telemetry (TimescaleDB Hypertable)
-- ============================================
CREATE TABLE IF NOT EXISTS telemetry (
    time                TIMESTAMPTZ NOT NULL,
    device_id           UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    device_type         device_type NOT NULL,

    -- Voltages (V)
    voltage_l1_n        DOUBLE PRECISION,
    voltage_l2_n        DOUBLE PRECISION,
    voltage_l3_n        DOUBLE PRECISION,
    voltage_l1_l2       DOUBLE PRECISION,
    voltage_l2_l3       DOUBLE PRECISION,
    voltage_l3_l1       DOUBLE PRECISION,

    -- Currents (A)
    current_l1          DOUBLE PRECISION,
    current_l2          DOUBLE PRECISION,
    current_l3          DOUBLE PRECISION,

    -- Power (W, VA, VAR)
    power_w_l1          DOUBLE PRECISION,
    power_w_l2          DOUBLE PRECISION,
    power_w_l3          DOUBLE PRECISION,
    power_w_total       DOUBLE PRECISION,
    power_va_l1         DOUBLE PRECISION,
    power_va_l2         DOUBLE PRECISION,
    power_va_l3         DOUBLE PRECISION,
    power_va_total      DOUBLE PRECISION,
    power_var_l1        DOUBLE PRECISION,
    power_var_l2        DOUBLE PRECISION,
    power_var_l3        DOUBLE PRECISION,
    power_var_total     DOUBLE PRECISION,

    -- Power Factor
    power_factor        DOUBLE PRECISION,
    power_factor_l1     DOUBLE PRECISION,
    power_factor_l2     DOUBLE PRECISION,
    power_factor_l3     DOUBLE PRECISION,

    -- Frequency (Hz)
    frequency_hz        DOUBLE PRECISION,

    -- Energy accumulators (kWh, kVARh)
    energy_kwh_total    DOUBLE PRECISION,
    energy_kvarh_total  DOUBLE PRECISION,
    energy_kwh_partial  DOUBLE PRECISION,
    energy_kvarh_partial DOUBLE PRECISION,
    energy_kwh_l1       DOUBLE PRECISION,
    energy_kwh_l2       DOUBLE PRECISION,
    energy_kwh_l3       DOUBLE PRECISION,
    energy_kwh_neg_total DOUBLE PRECISION,
    energy_kvarh_neg_total DOUBLE PRECISION,

    -- Demand
    demand_w            DOUBLE PRECISION,
    demand_w_max        DOUBLE PRECISION,
    demand_va           DOUBLE PRECISION,
    demand_va_max       DOUBLE PRECISION,
    demand_a_max        DOUBLE PRECISION,

    -- Hours counter
    hours_counter       DOUBLE PRECISION,

    -- Full raw payload for audit
    raw_data            JSONB
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('telemetry', 'time', if_not_exists => TRUE);

-- Indexes for common queries
CREATE INDEX idx_telemetry_device_time ON telemetry(device_id, time DESC);
CREATE INDEX idx_telemetry_device_type ON telemetry(device_type);

-- Compression policy: compress chunks older than 7 days
ALTER TABLE telemetry SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('telemetry', INTERVAL '7 days', if_not_exists => TRUE);

-- Retention policy: drop data older than 2 years
SELECT add_retention_policy('telemetry', INTERVAL '2 years', if_not_exists => TRUE);

-- ============================================
-- 11. Continuous Aggregates (Materialized Views)
-- ============================================

-- Hourly aggregates
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    device_id,
    device_type,
    AVG(voltage_l1_n) AS avg_voltage_l1,
    AVG(voltage_l2_n) AS avg_voltage_l2,
    AVG(voltage_l3_n) AS avg_voltage_l3,
    AVG(current_l1) AS avg_current_l1,
    AVG(current_l2) AS avg_current_l2,
    AVG(current_l3) AS avg_current_l3,
    AVG(power_w_total) AS avg_power_w,
    MAX(power_w_total) AS max_power_w,
    MIN(power_w_total) AS min_power_w,
    -- Per-phase power
    AVG(power_w_l1) AS avg_power_w_l1,
    AVG(power_w_l2) AS avg_power_w_l2,
    AVG(power_w_l3) AS avg_power_w_l3,
    MAX(power_w_l1) AS max_power_w_l1,
    MAX(power_w_l2) AS max_power_w_l2,
    MAX(power_w_l3) AS max_power_w_l3,
    MIN(power_w_l1) AS min_power_w_l1,
    MIN(power_w_l2) AS min_power_w_l2,
    MIN(power_w_l3) AS min_power_w_l3,
    AVG(power_va_total) AS avg_power_va,
    AVG(power_var_total) AS avg_power_var,
    AVG(power_factor) AS avg_power_factor,
    MIN(power_factor) AS min_power_factor,
    AVG(frequency_hz) AS avg_frequency,
    MAX(energy_kwh_total) - MIN(energy_kwh_total) AS delta_kwh,
    MAX(energy_kvarh_total) - MIN(energy_kvarh_total) AS delta_kvarh,
    -- Per-phase energy deltas
    MAX(energy_kwh_l1) - MIN(energy_kwh_l1) AS delta_kwh_l1,
    MAX(energy_kwh_l2) - MIN(energy_kwh_l2) AS delta_kwh_l2,
    MAX(energy_kwh_l3) - MIN(energy_kwh_l3) AS delta_kwh_l3,
    MAX(demand_w) AS max_demand_w,
    MAX(demand_va) AS max_demand_va,
    COUNT(*) AS sample_count
FROM telemetry
GROUP BY bucket, device_id, device_type
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_hourly',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- Daily aggregates (directly from raw telemetry, not cascading from hourly)
-- TimescaleDB 2.25 doesn't support cascading CAGGs with time_bucket on non-hypertable columns
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    device_id,
    device_type,
    AVG(voltage_l1_n) AS avg_voltage_l1,
    AVG(voltage_l2_n) AS avg_voltage_l2,
    AVG(voltage_l3_n) AS avg_voltage_l3,
    AVG(current_l1) AS avg_current_l1,
    AVG(current_l2) AS avg_current_l2,
    AVG(current_l3) AS avg_current_l3,
    AVG(power_w_total) AS avg_power_w,
    MAX(power_w_total) AS max_power_w,
    MIN(power_w_total) AS min_power_w,
    -- Per-phase power
    AVG(power_w_l1) AS avg_power_w_l1,
    AVG(power_w_l2) AS avg_power_w_l2,
    AVG(power_w_l3) AS avg_power_w_l3,
    MAX(power_w_l1) AS max_power_w_l1,
    MAX(power_w_l2) AS max_power_w_l2,
    MAX(power_w_l3) AS max_power_w_l3,
    MIN(power_w_l1) AS min_power_w_l1,
    MIN(power_w_l2) AS min_power_w_l2,
    MIN(power_w_l3) AS min_power_w_l3,
    AVG(power_va_total) AS avg_power_va,
    AVG(power_var_total) AS avg_power_var,
    AVG(power_factor) AS avg_power_factor,
    MIN(power_factor) AS min_power_factor,
    AVG(frequency_hz) AS avg_frequency,
    MAX(energy_kwh_total) - MIN(energy_kwh_total) AS delta_kwh,
    MAX(energy_kvarh_total) - MIN(energy_kvarh_total) AS delta_kvarh,
    -- Per-phase energy deltas
    MAX(energy_kwh_l1) - MIN(energy_kwh_l1) AS delta_kwh_l1,
    MAX(energy_kwh_l2) - MIN(energy_kwh_l2) AS delta_kwh_l2,
    MAX(energy_kwh_l3) - MIN(energy_kwh_l3) AS delta_kwh_l3,
    MAX(demand_w) AS max_demand_w,
    MAX(demand_va) AS max_demand_va,
    COUNT(*) AS sample_count
FROM telemetry
GROUP BY bucket, device_id, device_type
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_daily',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- ============================================
-- 12. Telemetry Realtime (Hot Cache)
-- ============================================
CREATE TABLE IF NOT EXISTS telemetry_realtime (
    device_id       UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    device_type     device_type NOT NULL,
    data            JSONB NOT NULL DEFAULT '{}',
    last_updated    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 13. Alarms
-- ============================================
CREATE TABLE IF NOT EXISTS alarms (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    factory_id      UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
    alarm_type      alarm_type NOT NULL,
    severity        alarm_severity NOT NULL DEFAULT 'warning',
    message         TEXT NOT NULL,
    value_detected  DOUBLE PRECISION,
    threshold_value DOUBLE PRECISION,
    acknowledged    BOOLEAN DEFAULT false,
    acknowledged_by UUID REFERENCES users(id),
    triggered_at    TIMESTAMPTZ DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ
);

CREATE INDEX idx_alarms_factory ON alarms(factory_id);
CREATE INDEX idx_alarms_device ON alarms(device_id);
CREATE INDEX idx_alarms_active ON alarms(factory_id, acknowledged) WHERE acknowledged = false;
CREATE INDEX idx_alarms_triggered ON alarms(triggered_at DESC);

-- ============================================
-- 14. Alarm Thresholds (Configurable per device)
-- ============================================
CREATE TABLE IF NOT EXISTS alarm_thresholds (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    alarm_type      alarm_type NOT NULL,
    severity        alarm_severity NOT NULL DEFAULT 'warning',
    min_value       DOUBLE PRECISION,
    max_value       DOUBLE PRECISION,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(device_id, alarm_type)
);

-- ============================================
-- 15. Vector Embeddings (pgvector for future AI/RAG)
-- ============================================
CREATE TABLE IF NOT EXISTS vector_embeddings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_type     VARCHAR(50) NOT NULL,
    source_id       UUID NOT NULL,
    content_text    TEXT,
    embedding       vector(1536),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vector_source ON vector_embeddings(source_type, source_id);
-- HNSW index for fast similarity search
CREATE INDEX idx_vector_embedding ON vector_embeddings
    USING hnsw (embedding vector_cosine_ops);

-- ============================================
-- 16. Audit Log
-- ============================================
CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id),
    action          VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(50) NOT NULL,
    entity_id       UUID,
    old_values      JSONB,
    new_values      JSONB,
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- ============================================
-- 17. Updated_at trigger function
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER trigger_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_factories_updated_at
    BEFORE UPDATE ON factories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_devices_updated_at
    BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_contracts_updated_at
    BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
