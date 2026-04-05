-- Migration 008: Add per-phase energy deltas to telemetry_hourly and telemetry_daily
-- Adds delta_kwh_l1/l2/l3 columns using energy_kwh_l1/l2/l3 from the hypertable
-- These columns are NULL for monofásico devices (they only store energy_kwh_total)
--
-- REQUIRES: telemetry_hourly and telemetry_daily to be dropped and recreated.
-- Run OUTSIDE a transaction: psql -U fpsaver_admin -d fpsaver -f 008_phase_energy_deltas.sql

-- 1. Drop both continuous aggregates (CASCADE handles policies)
DROP MATERIALIZED VIEW IF EXISTS telemetry_daily CASCADE;
DROP MATERIALIZED VIEW IF EXISTS telemetry_hourly CASCADE;

-- 2. Recreate telemetry_hourly with per-phase energy deltas
CREATE MATERIALIZED VIEW telemetry_hourly
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
    -- Per-phase energy deltas (NEW in 008)
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

-- 3. Recreate telemetry_daily with per-phase energy deltas
CREATE MATERIALIZED VIEW telemetry_daily
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
    -- Per-phase energy deltas (NEW in 008)
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

-- 4. Refresh aggregates to populate with existing data
-- Run manually OUTSIDE of a transaction block:
-- CALL refresh_continuous_aggregate('telemetry_hourly', NULL, NULL);
-- CALL refresh_continuous_aggregate('telemetry_daily', NULL, NULL);
