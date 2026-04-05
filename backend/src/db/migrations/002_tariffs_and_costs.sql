-- ============================================
-- FPSaver - Migration: ESIOS + Contracts + Cost
-- Phase 15: Electricity Tariffs & Cost Estimation
-- ============================================

-- 1. Tariff type enum
DO $$ BEGIN
    CREATE TYPE tariff_type AS ENUM ('2.0TD', '3.0TD', '6.1TD', '6.2TD', '6.3TD', '6.4TD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE pricing_model AS ENUM ('fixed', 'indexed_omie', 'pvpc');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Enhanced contracts table (add new columns to existing table)
ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS tariff_type tariff_type DEFAULT '6.1TD',
    ADD COLUMN IF NOT EXISTS pricing_model pricing_model DEFAULT 'fixed',
    ADD COLUMN IF NOT EXISTS comercializadora VARCHAR(255),
    -- Contracted power per period (kW)
    ADD COLUMN IF NOT EXISTS power_p1_kw DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS power_p2_kw DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS power_p3_kw DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS power_p4_kw DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS power_p5_kw DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS power_p6_kw DOUBLE PRECISION,
    -- Energy price per period (€/kWh, for fixed pricing)
    ADD COLUMN IF NOT EXISTS energy_price_p1 DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS energy_price_p2 DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS energy_price_p3 DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS energy_price_p4 DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS energy_price_p5 DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS energy_price_p6 DOUBLE PRECISION,
    -- Peajes (regulated, €/kWh)
    ADD COLUMN IF NOT EXISTS peaje_p1 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS peaje_p2 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS peaje_p3 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS peaje_p4 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS peaje_p5 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS peaje_p6 DOUBLE PRECISION DEFAULT 0.0,
    -- Cargos (regulated, €/kWh)
    ADD COLUMN IF NOT EXISTS cargo_p1 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS cargo_p2 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS cargo_p3 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS cargo_p4 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS cargo_p5 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS cargo_p6 DOUBLE PRECISION DEFAULT 0.0,
    -- Power peajes (€/kW/year)
    ADD COLUMN IF NOT EXISTS power_peaje_p1 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS power_peaje_p2 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS power_peaje_p3 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS power_peaje_p4 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS power_peaje_p5 DOUBLE PRECISION DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS power_peaje_p6 DOUBLE PRECISION DEFAULT 0.0,
    -- Taxes & extras
    ADD COLUMN IF NOT EXISTS electricity_tax DOUBLE PRECISION DEFAULT 5.1127,  -- %
    ADD COLUMN IF NOT EXISTS iva DOUBLE PRECISION DEFAULT 21.0,                -- %
    ADD COLUMN IF NOT EXISTS reactive_penalty_threshold DOUBLE PRECISION DEFAULT 33.0, -- % (cos φ limit)
    ADD COLUMN IF NOT EXISTS indexed_margin DOUBLE PRECISION DEFAULT 0.0,      -- €/kWh markup for indexed
    -- CUPS (universal supply point code)
    ADD COLUMN IF NOT EXISTS cups VARCHAR(22);

-- 3. Electricity prices hypertable (ESIOS data)
CREATE TABLE IF NOT EXISTS electricity_prices (
    time            TIMESTAMPTZ NOT NULL,
    price_type      VARCHAR(30) NOT NULL,     -- 'spot_omie', 'pvpc', 'pvpc_feu'
    price_eur_mwh   DOUBLE PRECISION NOT NULL, -- €/MWh (ESIOS unit)
    geo_id          INTEGER DEFAULT 3,         -- 3 = Spain
    source          VARCHAR(50) DEFAULT 'esios',
    indicator_id    INTEGER                    -- ESIOS indicator ID
);

SELECT create_hypertable('electricity_prices', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_ep_type_time
    ON electricity_prices(price_type, time DESC);

-- Compression for old price data
ALTER TABLE electricity_prices SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'price_type',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('electricity_prices', INTERVAL '30 days', if_not_exists => TRUE);

-- 4. Spanish national holidays table
CREATE TABLE IF NOT EXISTS holidays (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date            DATE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    region          VARCHAR(50) DEFAULT 'national',  -- 'national', 'cataluña', 'madrid', etc.
    UNIQUE(date, region)
);

-- Insert 2025 + 2026 national holidays
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
