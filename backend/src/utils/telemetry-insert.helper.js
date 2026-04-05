/**
 * Shared telemetry INSERT helper
 * Single source of truth for the telemetry hypertable INSERT statement.
 * Used by both mqtt.service.js (MQTT ingestion) and telemetry.controller.js (HTTP ingestion).
 */

/**
 * Build a parameterized INSERT query for the telemetry hypertable.
 * All fields from the full EM340/EM111 schema are included.
 * Missing fields in the data object gracefully default to null.
 *
 * @param {object} data - Telemetry data payload from Raspberry Pi
 * @param {object} hierarchy - { parent_device_id, parent_relation }
 * @param {string} deviceId - Device UUID
 * @param {string} deviceType - 'trifasica', 'monofasica', etc.
 * @param {string} timestamp - ISO 8601 timestamp
 * @returns {{ sql: string, params: any[] }}
 */
const buildTelemetryInsert = (data, hierarchy, deviceId, deviceType, timestamp) => {
    const d = data || {};
    const h = hierarchy || {};

    const sql = `INSERT INTO telemetry (
        time, device_id, device_type,
        parent_device_id, parent_relation,
        voltage_l1_n, voltage_l2_n, voltage_l3_n,
        voltage_l1_l2, voltage_l2_l3, voltage_l3_l1,
        current_l1, current_l2, current_l3,
        power_w_l1, power_w_l2, power_w_l3, power_w_total,
        power_va_l1, power_va_l2, power_va_l3, power_va_total,
        power_var_l1, power_var_l2, power_var_l3, power_var_total,
        power_factor, power_factor_l1, power_factor_l2, power_factor_l3,
        frequency_hz,
        energy_kwh_total, energy_kvarh_total, energy_kwh_partial, energy_kvarh_partial,
        energy_kwh_l1, energy_kwh_l2, energy_kwh_l3,
        energy_kwh_neg_total, energy_kvarh_neg_total,
        demand_w, demand_w_max, demand_va, demand_va_max, demand_a_max,
        hours_counter, raw_data
    ) VALUES (
        $1, $2, $3,
        $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20, $21, $22,
        $23, $24, $25, $26,
        $27, $28, $29, $30,
        $31,
        $32, $33, $34, $35,
        $36, $37, $38,
        $39, $40,
        $41, $42, $43, $44, $45,
        $46, $47
    )`;

    const params = [
        timestamp || new Date().toISOString(),
        deviceId,
        deviceType || 'trifasica',
        // Hierarchy
        h.parent_device_id || null,
        h.parent_relation || null,
        // Voltages
        d.voltage_l1_n ?? null, d.voltage_l2_n ?? null, d.voltage_l3_n ?? null,
        d.voltage_l1_l2 ?? null, d.voltage_l2_l3 ?? null, d.voltage_l3_l1 ?? null,
        // Currents
        d.current_l1 ?? null, d.current_l2 ?? null, d.current_l3 ?? null,
        // Active power (W)
        d.power_w_l1 ?? null, d.power_w_l2 ?? null, d.power_w_l3 ?? null,
        d.power_w_total || d.power_w || null,
        // Apparent power (VA)
        d.power_va_l1 ?? null, d.power_va_l2 ?? null, d.power_va_l3 ?? null,
        d.power_va_total || d.power_va || null,
        // Reactive power (VAR)
        d.power_var_l1 ?? null, d.power_var_l2 ?? null, d.power_var_l3 ?? null,
        d.power_var_total || d.power_var || null,
        // Power factor
        d.power_factor ?? null,
        d.power_factor_l1 ?? null, d.power_factor_l2 ?? null, d.power_factor_l3 ?? null,
        // Frequency
        d.frequency_hz ?? null,
        // Energy
        d.energy_kwh_total ?? null, d.energy_kvarh_total ?? null,
        d.energy_kwh_partial ?? null, d.energy_kvarh_partial ?? null,
        d.energy_kwh_l1 ?? null, d.energy_kwh_l2 ?? null, d.energy_kwh_l3 ?? null,
        d.energy_kwh_neg_total ?? null, d.energy_kvarh_neg_total ?? null,
        // Demand
        d.demand_w ?? null, d.demand_w_max ?? null,
        d.demand_va ?? null, d.demand_va_max ?? null, d.demand_a_max ?? null,
        // Misc
        d.hours_counter ?? null,
        JSON.stringify(d),
    ];

    return { sql, params };
};

/**
 * Build the realtime cache UPSERT query.
 * @param {string} deviceId
 * @param {string} deviceType
 * @param {object} data
 * @param {string} timestamp
 * @returns {{ sql: string, params: any[] }}
 */
const buildRealtimeUpsert = (deviceId, deviceType, data, timestamp) => {
    const sql = `INSERT INTO telemetry_realtime (device_id, device_type, data, last_updated)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (device_id)
        DO UPDATE SET data = $3, device_type = $2, last_updated = $4`;

    const params = [
        deviceId,
        deviceType || 'trifasica',
        JSON.stringify(data),
        timestamp || new Date().toISOString(),
    ];

    return { sql, params };
};

module.exports = { buildTelemetryInsert, buildRealtimeUpsert };
