/**
 * Voltio — Initial Schema Migration (Consolidated)
 *
 * This single migration contains the complete database schema,
 * consolidated from all previous development migrations into one
 * clean starting point.
 *
 * Includes: Extensions, ENUMs, all tables, hypertables, continuous
 * aggregates, indexes, constraints, triggers, and seed data.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.sql(`
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

DO $$ BEGIN
    CREATE TYPE tariff_type AS ENUM ('2.0TD', '3.0TD', '6.1TD', '6.2TD', '6.3TD', '6.4TD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE pricing_model AS ENUM ('fixed', 'indexed_omie', 'pvpc');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 3. Updated_at Trigger Function
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. Companies (Tenants)
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

CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(is_active);

DO $$ BEGIN
    CREATE TRIGGER trigger_companies_updated_at
        BEFORE UPDATE ON companies
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 5. Users
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

CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

DO $$ BEGIN
    CREATE TRIGGER trigger_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 6. Refresh Tokens (JWT Rotation)
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

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_jti ON refresh_tokens(jti);

-- ============================================
-- 7. Factories
-- ============================================
CREATE TABLE IF NOT EXISTS factories (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id              UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name                    VARCHAR(255) NOT NULL,
    location_address        TEXT,
    city                    VARCHAR(100),
    latitude                DOUBLE PRECISION,
    longitude               DOUBLE PRECISION,
    timezone                VARCHAR(50) DEFAULT 'Europe/Madrid',
    mqtt_topic              VARCHAR(255) UNIQUE,
    -- MQTT credentials (from mqtt_credentials migration)
    mqtt_username           VARCHAR(100) UNIQUE,
    mqtt_password_hash      VARCHAR(255),
    mqtt_password_encrypted TEXT,
    -- Regional config (from cost_history migration)
    comunidad_autonoma      VARCHAR(50) DEFAULT 'nacional',
    is_active               BOOLEAN DEFAULT true,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_factories_company ON factories(company_id);
CREATE INDEX IF NOT EXISTS idx_factories_active ON factories(is_active);

DO $$ BEGIN
    CREATE TRIGGER trigger_factories_updated_at
        BEFORE UPDATE ON factories
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 8. User-Factory Access (RBAC Matrix)
-- ============================================
CREATE TABLE IF NOT EXISTS user_factory_access (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    factory_id      UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    granted_at      TIMESTAMPTZ DEFAULT NOW(),
    granted_by      UUID REFERENCES users(id),
    UNIQUE(user_id, factory_id)
);

CREATE INDEX IF NOT EXISTS idx_ufa_user ON user_factory_access(user_id);
CREATE INDEX IF NOT EXISTS idx_ufa_factory ON user_factory_access(factory_id);

-- ============================================
-- 9. Devices (Energy Meters)
-- ============================================
CREATE TABLE IF NOT EXISTS devices (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    factory_id          UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    name                VARCHAR(255) NOT NULL,
    serial_number       VARCHAR(100),
    device_type         device_type NOT NULL DEFAULT 'trifasica',
    modbus_address      INTEGER NOT NULL DEFAULT 1,
    model               VARCHAR(100) DEFAULT 'EM340',
    description         TEXT,
    metadata            JSONB DEFAULT '{}',
    -- Network (from device_discovery migration)
    host                VARCHAR(45),
    port                INTEGER DEFAULT 502,
    -- Hierarchy (from device_hierarchy migration)
    device_role         VARCHAR(20) DEFAULT 'sub_meter',
    parent_device_id    UUID REFERENCES devices(id) ON DELETE SET NULL,
    parent_relation     VARCHAR(20),
    phase_channel       VARCHAR(2),
    is_active           BOOLEAN DEFAULT true,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    -- Unique per factory+host+modbus (from fix_device_unique migration)
    UNIQUE(factory_id, host, modbus_address),
    -- Hierarchy constraints
    CONSTRAINT chk_parent_relation
        CHECK (parent_relation IS NULL OR parent_relation IN ('phase_channel', 'downstream')),
    CONSTRAINT chk_phase_channel
        CHECK (phase_channel IS NULL OR phase_channel IN ('L1', 'L2', 'L3')),
    CONSTRAINT chk_phase_requires_parent
        CHECK (phase_channel IS NULL OR parent_device_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_devices_factory ON devices(factory_id);
CREATE INDEX IF NOT EXISTS idx_devices_active ON devices(is_active);
CREATE INDEX IF NOT EXISTS idx_devices_type ON devices(device_type);
CREATE INDEX IF NOT EXISTS idx_devices_parent ON devices(parent_device_id);
CREATE INDEX IF NOT EXISTS idx_devices_role ON devices(device_role);

DO $$ BEGIN
    CREATE TRIGGER trigger_devices_updated_at
        BEFORE UPDATE ON devices
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 10. Discovered Devices (Auto-discovery)
-- ============================================
CREATE TABLE IF NOT EXISTS discovered_devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id      UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    ip_address      VARCHAR(45) NOT NULL,
    port            INTEGER DEFAULT 502,
    modbus_address  INTEGER DEFAULT 1,
    detected_model  VARCHAR(50),
    detected_type   VARCHAR(20) CHECK (detected_type IN ('trifasica', 'monofasica', 'master')),
    voltage_sample  DECIMAL(10,2),
    status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'ignored')),
    discovered_at   TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at    TIMESTAMPTZ,
    confirmed_by    UUID REFERENCES users(id),
    device_id       UUID REFERENCES devices(id),
    UNIQUE(factory_id, ip_address)
);

CREATE INDEX IF NOT EXISTS idx_discovered_devices_factory
    ON discovered_devices(factory_id, status);

-- ============================================
-- 11. Contracts (Electrical Tariffs)
-- ============================================
CREATE TABLE IF NOT EXISTS contracts (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id                  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    factory_id                  UUID REFERENCES factories(id) ON DELETE SET NULL,
    provider                    VARCHAR(255) NOT NULL,
    contract_number             VARCHAR(100),
    contracted_power_kw         DOUBLE PRECISION,
    price_kwh_default           DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    tariff_periods              JSONB DEFAULT '{}',
    currency                    VARCHAR(3) DEFAULT 'EUR',
    start_date                  DATE NOT NULL,
    end_date                    DATE,
    -- Tariff configuration (from tariffs_and_costs migration)
    tariff_type                 tariff_type DEFAULT '6.1TD',
    pricing_model               pricing_model DEFAULT 'fixed',
    comercializadora            VARCHAR(255),
    -- Contracted power per period (kW)
    power_p1_kw                 DOUBLE PRECISION,
    power_p2_kw                 DOUBLE PRECISION,
    power_p3_kw                 DOUBLE PRECISION,
    power_p4_kw                 DOUBLE PRECISION,
    power_p5_kw                 DOUBLE PRECISION,
    power_p6_kw                 DOUBLE PRECISION,
    -- Energy price per period (EUR/kWh, for fixed pricing)
    energy_price_p1             DOUBLE PRECISION,
    energy_price_p2             DOUBLE PRECISION,
    energy_price_p3             DOUBLE PRECISION,
    energy_price_p4             DOUBLE PRECISION,
    energy_price_p5             DOUBLE PRECISION,
    energy_price_p6             DOUBLE PRECISION,
    -- Peajes (regulated, EUR/kWh)
    peaje_p1                    DOUBLE PRECISION DEFAULT 0.0,
    peaje_p2                    DOUBLE PRECISION DEFAULT 0.0,
    peaje_p3                    DOUBLE PRECISION DEFAULT 0.0,
    peaje_p4                    DOUBLE PRECISION DEFAULT 0.0,
    peaje_p5                    DOUBLE PRECISION DEFAULT 0.0,
    peaje_p6                    DOUBLE PRECISION DEFAULT 0.0,
    -- Cargos (regulated, EUR/kWh)
    cargo_p1                    DOUBLE PRECISION DEFAULT 0.0,
    cargo_p2                    DOUBLE PRECISION DEFAULT 0.0,
    cargo_p3                    DOUBLE PRECISION DEFAULT 0.0,
    cargo_p4                    DOUBLE PRECISION DEFAULT 0.0,
    cargo_p5                    DOUBLE PRECISION DEFAULT 0.0,
    cargo_p6                    DOUBLE PRECISION DEFAULT 0.0,
    -- Power peajes (EUR/kW/year)
    power_peaje_p1              DOUBLE PRECISION DEFAULT 0.0,
    power_peaje_p2              DOUBLE PRECISION DEFAULT 0.0,
    power_peaje_p3              DOUBLE PRECISION DEFAULT 0.0,
    power_peaje_p4              DOUBLE PRECISION DEFAULT 0.0,
    power_peaje_p5              DOUBLE PRECISION DEFAULT 0.0,
    power_peaje_p6              DOUBLE PRECISION DEFAULT 0.0,
    -- Taxes & extras
    electricity_tax             DOUBLE PRECISION DEFAULT 5.1127,
    iva                         DOUBLE PRECISION DEFAULT 21.0,
    reactive_penalty_threshold  DOUBLE PRECISION DEFAULT 33.0,
    indexed_margin              DOUBLE PRECISION DEFAULT 0.0,
    cups                        VARCHAR(22),
    is_active                   BOOLEAN DEFAULT true,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_company ON contracts(company_id);
CREATE INDEX IF NOT EXISTS idx_contracts_factory ON contracts(factory_id);

DO $$ BEGIN
    CREATE TRIGGER trigger_contracts_updated_at
        BEFORE UPDATE ON contracts
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 12. Electricity Prices (ESIOS Hypertable)
-- ============================================
CREATE TABLE IF NOT EXISTS electricity_prices (
    time            TIMESTAMPTZ NOT NULL,
    price_type      VARCHAR(30) NOT NULL,
    price_eur_mwh   DOUBLE PRECISION NOT NULL,
    geo_id          INTEGER DEFAULT 3,
    source          VARCHAR(50) DEFAULT 'esios',
    indicator_id    INTEGER
);

SELECT create_hypertable('electricity_prices', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_ep_type_time
    ON electricity_prices(price_type, time DESC);

ALTER TABLE electricity_prices SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'price_type',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('electricity_prices', INTERVAL '30 days', if_not_exists => TRUE);

-- ============================================
-- 13. Holidays (Spanish Calendar)
-- ============================================
CREATE TABLE IF NOT EXISTS holidays (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date            DATE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    region          VARCHAR(50) DEFAULT 'national',
    UNIQUE(date, region)
);

INSERT INTO holidays (date, name, region) VALUES
    ('2025-01-01', 'Año Nuevo', 'national'),
    ('2025-01-06', 'Epifanía del Señor', 'national'),
    ('2025-04-18', 'Viernes Santo', 'national'),
    ('2025-05-01', 'Fiesta del Trabajo', 'national'),
    ('2025-08-15', 'Asunción de la Virgen', 'national'),
    ('2025-10-12', 'Fiesta Nacional de España', 'national'),
    ('2025-11-01', 'Todos los Santos', 'national'),
    ('2025-12-06', 'Día de la Constitución', 'national'),
    ('2025-12-08', 'Inmaculada Concepción', 'national'),
    ('2025-12-25', 'Navidad', 'national'),
    ('2026-01-01', 'Año Nuevo', 'national'),
    ('2026-01-06', 'Epifanía del Señor', 'national'),
    ('2026-04-03', 'Viernes Santo', 'national'),
    ('2026-05-01', 'Fiesta del Trabajo', 'national'),
    ('2026-08-15', 'Asunción de la Virgen', 'national'),
    ('2026-10-12', 'Fiesta Nacional de España', 'national'),
    ('2026-11-01', 'Todos los Santos', 'national'),
    ('2026-12-06', 'Día de la Constitución', 'national'),
    ('2026-12-08', 'Inmaculada Concepción', 'national'),
    ('2026-12-25', 'Navidad', 'national')
ON CONFLICT (date, region) DO NOTHING;

-- ============================================
-- 14. Cost Snapshots (Hourly Cost History)
-- ============================================
CREATE TABLE IF NOT EXISTS cost_snapshots (
    id              UUID DEFAULT gen_random_uuid(),
    factory_id      UUID NOT NULL REFERENCES factories(id),
    contract_id     UUID NOT NULL REFERENCES contracts(id),
    timestamp       TIMESTAMPTZ NOT NULL,
    period          TEXT NOT NULL,
    price_kwh       NUMERIC(10,6) NOT NULL,
    price_kwh_no_tax NUMERIC(10,6),
    kwh_consumed    NUMERIC(12,4) DEFAULT 0,
    cost_eur        NUMERIC(12,4) DEFAULT 0,
    pricing_model   TEXT,
    spot_price      NUMERIC(10,6),
    breakdown       JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('cost_snapshots', 'timestamp', if_not_exists => true);
CREATE INDEX IF NOT EXISTS idx_cost_snapshots_factory ON cost_snapshots(factory_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cost_snapshots_contract ON cost_snapshots(contract_id, timestamp DESC);

-- ============================================
-- 15. Telemetry (TimescaleDB Hypertable)
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

    -- Hierarchy snapshot (from telemetry_hierarchy migration)
    parent_device_id    UUID,
    parent_relation     VARCHAR(20),

    -- Full raw payload for audit
    raw_data            JSONB
);

SELECT create_hypertable('telemetry', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON telemetry(device_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_type ON telemetry(device_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_parent
    ON telemetry(parent_device_id, time DESC)
    WHERE parent_device_id IS NOT NULL;

-- Compression: compress chunks older than 7 days
ALTER TABLE telemetry SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('telemetry', INTERVAL '7 days', if_not_exists => TRUE);

-- Retention: drop data older than 2 years
SELECT add_retention_policy('telemetry', INTERVAL '2 years', if_not_exists => TRUE);

-- ============================================
-- 16. Continuous Aggregates
-- ============================================

-- Hourly aggregates (with per-phase power + energy deltas)
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
    -- Energy deltas (total)
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

-- Daily aggregates (directly from raw telemetry)
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
-- 17. Telemetry Realtime (Hot Cache)
-- ============================================
CREATE TABLE IF NOT EXISTS telemetry_realtime (
    device_id       UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    device_type     device_type NOT NULL,
    data            JSONB NOT NULL DEFAULT '{}',
    last_updated    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 18. Alarms
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

CREATE INDEX IF NOT EXISTS idx_alarms_factory ON alarms(factory_id);
CREATE INDEX IF NOT EXISTS idx_alarms_device ON alarms(device_id);
CREATE INDEX IF NOT EXISTS idx_alarms_active ON alarms(factory_id, acknowledged) WHERE acknowledged = false;
CREATE INDEX IF NOT EXISTS idx_alarms_triggered ON alarms(triggered_at DESC);

-- ============================================
-- 19. Alarm Thresholds
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
-- 20. Graph Node Positions (VueFlow Canvas)
-- ============================================
CREATE TABLE IF NOT EXISTS graph_node_positions (
    factory_id  UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    node_id     VARCHAR(100) NOT NULL,
    pos_x       DOUBLE PRECISION NOT NULL DEFAULT 0,
    pos_y       DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (factory_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_gnp_factory ON graph_node_positions(factory_id);

-- ============================================
-- 21. Production Lines
-- ============================================
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

DO $$ BEGIN
    CREATE TRIGGER trigger_production_lines_updated_at
        BEFORE UPDATE ON production_lines
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 22. Production Line Devices (Current Membership)
-- ============================================
CREATE TABLE IF NOT EXISTS production_line_devices (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_line_id  UUID NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    device_id           UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    added_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(production_line_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_pld_line ON production_line_devices(production_line_id);
CREATE INDEX IF NOT EXISTS idx_pld_device ON production_line_devices(device_id);

-- ============================================
-- 23. Production Line Membership Log (Temporal History)
-- ============================================
CREATE TABLE IF NOT EXISTS production_line_membership_log (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_line_id  UUID NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
    device_id           UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    action              VARCHAR(10) NOT NULL CHECK (action IN ('added', 'removed')),
    timestamp           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plml_line ON production_line_membership_log(production_line_id);
CREATE INDEX IF NOT EXISTS idx_plml_line_time ON production_line_membership_log(production_line_id, timestamp);

-- ============================================
-- 24. Device Hierarchy Log (Temporal History)
-- ============================================
CREATE TABLE IF NOT EXISTS device_hierarchy_log (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id        UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    parent_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    parent_relation  VARCHAR(20),
    phase_channel    VARCHAR(5),
    action           VARCHAR(10) NOT NULL CHECK (action IN ('attached', 'detached')),
    timestamp        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dhl_device ON device_hierarchy_log(device_id);
CREATE INDEX IF NOT EXISTS idx_dhl_parent ON device_hierarchy_log(parent_device_id);
CREATE INDEX IF NOT EXISTS idx_dhl_device_time ON device_hierarchy_log(device_id, timestamp);

-- ============================================
-- 25. System Notifications
-- ============================================
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

-- ============================================
-- 26. Vector Embeddings (pgvector for AI/RAG)
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

CREATE INDEX IF NOT EXISTS idx_vector_source ON vector_embeddings(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_vector_embedding ON vector_embeddings
    USING hnsw (embedding vector_cosine_ops);

-- ============================================
-- 27. Audit Log
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

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
-- ============================================
-- Rollback: Drop everything in reverse order
-- ============================================
DROP INDEX IF EXISTS idx_audit_created;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP INDEX IF EXISTS idx_vector_embedding;
DROP TABLE IF EXISTS vector_embeddings CASCADE;
DROP TABLE IF EXISTS system_notifications CASCADE;
DROP TABLE IF EXISTS device_hierarchy_log CASCADE;
DROP TABLE IF EXISTS production_line_membership_log CASCADE;
DROP TABLE IF EXISTS production_line_devices CASCADE;
DROP TABLE IF EXISTS production_lines CASCADE;
DROP TABLE IF EXISTS graph_node_positions CASCADE;
DROP TABLE IF EXISTS alarm_thresholds CASCADE;
DROP TABLE IF EXISTS alarms CASCADE;
DROP TABLE IF EXISTS telemetry_realtime CASCADE;
DROP MATERIALIZED VIEW IF EXISTS telemetry_daily CASCADE;
DROP MATERIALIZED VIEW IF EXISTS telemetry_hourly CASCADE;
DROP TABLE IF EXISTS telemetry CASCADE;
DROP TABLE IF EXISTS cost_snapshots CASCADE;
DROP TABLE IF EXISTS holidays CASCADE;
DROP TABLE IF EXISTS electricity_prices CASCADE;
DROP TABLE IF EXISTS contracts CASCADE;
DROP TABLE IF EXISTS discovered_devices CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS user_factory_access CASCADE;
DROP TABLE IF EXISTS factories CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS companies CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
DROP TYPE IF EXISTS pricing_model CASCADE;
DROP TYPE IF EXISTS tariff_type CASCADE;
DROP TYPE IF EXISTS alarm_type CASCADE;
DROP TYPE IF EXISTS alarm_severity CASCADE;
DROP TYPE IF EXISTS device_type CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;
DROP EXTENSION IF EXISTS vector CASCADE;
DROP EXTENSION IF EXISTS timescaledb CASCADE;
DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;
    `);
};
