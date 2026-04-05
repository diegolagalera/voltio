const db = require('../config/database');
const websocket = require('../config/websocket');
const mqttClient = require('../config/mqtt');
const { buildTelemetryInsert, buildRealtimeUpsert } = require('../utils/telemetry-insert.helper');
const notificationService = require('./notification.service');

/**
 * Classify a PostgreSQL error as permanent (don't retry) or transient (retry later).
 *
 * Permanent errors:  FK violation (device deleted), enum mismatch, schema errors
 * Transient errors:  connection timeout, disk full, deadlock
 */
const classifyDbError = (err) => {
    const code = err.code || '';
    // PostgreSQL error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
    const permanentCodes = [
        '23503', // foreign_key_violation (device doesn't exist)
        '23505', // unique_violation
        '23514', // check_violation
        '22P02', // invalid_text_representation (bad enum value)
        '42804', // datatype_mismatch
    ];
    return permanentCodes.includes(code) ? 'permanent' : 'transient';
};

/**
 * Process BATCH telemetry (factory/{id}/telemetry)
 * → Store in DB + emit WebSocket + ALWAYS send ACK
 *
 * Each reading is processed independently. A single bad reading
 * cannot prevent the others from being stored or block the ACK.
 * Errors are classified so the gateway knows whether to retry.
 */
const processTelemetryMessage = async (topic, payload) => {
    let batchId = null;
    let factoryId = null;

    try {
        const data = JSON.parse(payload.toString());
        factoryId = topic.split('/')[1];

        // Support new batch format { batch_id, readings } or legacy array
        batchId = data.batch_id || null;
        const readings = data.readings || (Array.isArray(data) ? data : [data]);

        let storedCount = 0;
        let errorCount = 0;
        let permanentErrors = 0;
        const failedDevices = [];

        // Cache device hierarchy per batch to avoid redundant lookups
        const hierarchyCache = {};
        const getHierarchy = async (deviceId) => {
            if (hierarchyCache[deviceId] !== undefined) return hierarchyCache[deviceId];
            try {
                const res = await db.query(
                    'SELECT parent_device_id, parent_relation FROM devices WHERE id = $1',
                    [deviceId]
                );
                hierarchyCache[deviceId] = res.rows[0] || { parent_device_id: null, parent_relation: null };
            } catch (e) {
                hierarchyCache[deviceId] = { parent_device_id: null, parent_relation: null };
            }
            return hierarchyCache[deviceId];
        };

        for (const reading of readings) {
            const { device_id, device_type, timestamp, data: telemetryData } = reading;

            if (!device_id || !telemetryData) {
                console.warn('[MQTT] Invalid telemetry payload, skipping:', reading);
                errorCount++;
                permanentErrors++;
                continue;
            }

            try {
                // Get device hierarchy for denormalization
                const hierarchy = await getHierarchy(device_id);

                // Insert into hypertable
                const insert = buildTelemetryInsert(
                    telemetryData, hierarchy, device_id, device_type,
                    timestamp || new Date().toISOString()
                );
                await db.query(insert.sql, insert.params);

                // Update realtime cache
                const upsert = buildRealtimeUpsert(
                    device_id, device_type || 'trifasica', telemetryData,
                    timestamp || new Date().toISOString()
                );
                await db.query(upsert.sql, upsert.params);

                // Check alarm thresholds
                await checkAlarmThresholds(factoryId, device_id, telemetryData);
                storedCount++;
            } catch (readingErr) {
                errorCount++;
                const errorType = classifyDbError(readingErr);
                if (errorType === 'permanent') permanentErrors++;
                failedDevices.push({
                    device_id,
                    error: readingErr.message,
                    error_type: errorType,
                    pg_code: readingErr.code || null,
                });
                console.warn(
                    `[MQTT] Reading error (${errorType}) for device ${device_id}: ${readingErr.message}`
                );
            }
        }

        // Emit to WebSocket (only successful readings)
        if (storedCount > 0 && websocket.hasActiveListeners(factoryId)) {
            websocket.emitTelemetry(factoryId, readings);
        }

        // ── ALWAYS send ACK — never let a batch become a zombie ──
        if (batchId) {
            const client = mqttClient.getClient();
            if (client) {
                const ackTopic = `factory/${factoryId}/ack`;
                const ackPayload = JSON.stringify({
                    batch_id: batchId,
                    status: storedCount > 0 ? 'ok' : 'error',
                    readings_stored: storedCount,
                    errors: errorCount,
                    permanent_errors: permanentErrors,
                    failed_devices: failedDevices.length > 0 ? failedDevices : undefined,
                    timestamp: new Date().toISOString(),
                });
                client.publish(ackTopic, ackPayload, { qos: 1 });
            }
        }

        // Check system events (PF, imbalance, peak) — runs once per batch
        if (storedCount > 0) {
            await checkSystemEvents(factoryId, readings);
        }

        // Summary log
        if (errorCount > 0) {
            console.warn(
                `[MQTT] Batch partial: ${storedCount} stored, ${errorCount} errors `
                + `(${permanentErrors} permanent) for factory ${factoryId}`
                + (batchId ? ` (batch ${batchId.substring(0, 8)})` : '')
            );
        } else {
            console.log(
                `[MQTT] Batch stored: ${storedCount} readings for factory ${factoryId}`
                + (batchId ? ` (batch ${batchId.substring(0, 8)})` : '')
            );
        }
    } catch (err) {
        // Top-level error (JSON parse, MQTT issue) — still try to send ACK
        console.error('[MQTT] Critical error processing telemetry:', err.message);
        if (batchId && factoryId) {
            try {
                const client = mqttClient.getClient();
                if (client) {
                    client.publish(`factory/${factoryId}/ack`, JSON.stringify({
                        batch_id: batchId,
                        status: 'error',
                        readings_stored: 0,
                        errors: 1,
                        permanent_errors: 0,
                        error_message: err.message,
                        timestamp: new Date().toISOString(),
                    }), { qos: 1 });
                }
            } catch (_) { /* last resort — nothing more we can do */ }
        }
    }
};

/**
 * Process REALTIME telemetry (factory/{id}/realtime)
 * → WebSocket ONLY — NEVER stored in DB
 */
const processRealtimeMessage = async (topic, payload) => {
    try {
        const data = JSON.parse(payload.toString());
        const factoryId = topic.split('/')[1];

        const readings = Array.isArray(data) ? data : [data];

        // Update realtime cache only (ephemeral, for current values)
        for (const reading of readings) {
            const { device_id, device_type, data: telemetryData } = reading;
            if (!device_id || !telemetryData) continue;

            const upsert = buildRealtimeUpsert(device_id, device_type, telemetryData);
            await db.query(upsert.sql, upsert.params);
        }

        // Forward to WebSocket for live dashboard
        if (websocket.hasActiveListeners(factoryId)) {
            websocket.emitTelemetry(factoryId, readings);
        }

        // NO DB insert — this is ephemeral real-time data
    } catch (err) {
        console.error('[MQTT] Error processing realtime:', err.message);
    }
};

/**
 * Check alarm thresholds for a device reading
 */
const checkAlarmThresholds = async (factoryId, deviceId, data) => {
    try {
        const thresholds = await db.query(
            'SELECT * FROM alarm_thresholds WHERE device_id = $1 AND is_active = true',
            [deviceId]
        );

        for (const threshold of thresholds.rows) {
            let value = null;
            let triggered = false;

            switch (threshold.alarm_type) {
                case 'overvoltage':
                    value = data.voltage_l1_n || data.voltage;
                    triggered = value && threshold.max_value && value > threshold.max_value;
                    break;
                case 'undervoltage':
                    value = data.voltage_l1_n || data.voltage;
                    triggered = value && threshold.min_value && value < threshold.min_value;
                    break;
                case 'overcurrent':
                    value = Math.max(data.current_l1 || 0, data.current_l2 || 0, data.current_l3 || 0, data.current || 0);
                    triggered = value && threshold.max_value && value > threshold.max_value;
                    break;
                case 'low_power_factor':
                    value = data.power_factor;
                    triggered = value && threshold.min_value && value < threshold.min_value;
                    break;
                case 'overdemand':
                    value = data.demand_w || data.power_w_total || data.power_w;
                    triggered = value && threshold.max_value && value > threshold.max_value;
                    break;
                case 'frequency_deviation':
                    value = data.frequency_hz;
                    triggered = value && (
                        (threshold.min_value && value < threshold.min_value) ||
                        (threshold.max_value && value > threshold.max_value)
                    );
                    break;
            }

            if (triggered) {
                const alarm = await db.query(
                    `INSERT INTO alarms (factory_id, device_id, alarm_type, severity, message, value_detected, threshold_value)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                    [
                        factoryId, deviceId, threshold.alarm_type, threshold.severity,
                        `${threshold.alarm_type}: detected ${value}, threshold ${threshold.max_value || threshold.min_value}`,
                        value, threshold.max_value || threshold.min_value,
                    ]
                );
                websocket.emitAlarm(factoryId, alarm.rows[0]);
                console.log(`[ALARM] ${threshold.alarm_type} triggered for device ${deviceId}`);
            }
        }
    } catch (err) {
        console.error('[ALARM] Error checking thresholds:', err.message);
    }
};

/**
 * Check system-level events on the general meter (runs once per batch).
 * Uses incident-based model: open → update count → resolve.
 * Events: power_factor_low, phase_imbalance, power_peak
 */
const checkSystemEvents = async (factoryId, readings) => {
    try {
        // Find the general meter in this batch
        const generalResult = await db.query(
            `SELECT id FROM devices WHERE factory_id = $1 AND device_role = 'general_meter' AND is_active = true LIMIT 1`,
            [factoryId]
        );
        if (!generalResult.rows.length) return;

        const generalId = generalResult.rows[0].id;
        const generalReading = readings.find(r => r.device_id === generalId);
        if (!generalReading?.data) return;

        const d = generalReading.data;

        // ── 1. Power Factor < 0.90 ──
        const pf = parseFloat(d.power_factor || 0);
        if (pf > 0) {
            await notificationService.checkAndNotify(factoryId, 'power_factor_low', {
                triggered: pf < 0.90,
                severity: pf < 0.80 ? 'critical' : 'warning',
                title: pf < 0.90
                    ? `Factor de potencia bajo: ${pf.toFixed(3)}`
                    : `Factor de potencia recuperado: ${pf.toFixed(3)}`,
                message: pf < 0.90
                    ? `El FP general ha caído a ${pf.toFixed(3)} (umbral: 0.90). Posible penalización por reactiva.`
                    : `El FP general se ha recuperado a ${pf.toFixed(3)} (≥ 0.90).`,
                deviceId: generalId,
                metadata: { power_factor: pf },
            });
        }

        // ── 2. Phase imbalance > 10% ──
        const i1 = parseFloat(d.current_l1 || 0);
        const i2 = parseFloat(d.current_l2 || 0);
        const i3 = parseFloat(d.current_l3 || 0);
        if (i1 > 0 || i2 > 0 || i3 > 0) {
            const avg = (i1 + i2 + i3) / 3;
            const imbalance = avg > 0 ? ((Math.max(i1, i2, i3) - Math.min(i1, i2, i3)) / avg) * 100 : 0;

            await notificationService.checkAndNotify(factoryId, 'phase_imbalance', {
                triggered: imbalance > 10,
                severity: imbalance > 20 ? 'critical' : 'warning',
                title: imbalance > 10
                    ? `Desequilibrio de fases: ${imbalance.toFixed(1)}%`
                    : `Fases equilibradas: ${imbalance.toFixed(1)}%`,
                message: imbalance > 10
                    ? `Desequilibrio de corriente entre fases del ${imbalance.toFixed(1)}% (umbral: 10%). L1: ${i1.toFixed(1)}A, L2: ${i2.toFixed(1)}A, L3: ${i3.toFixed(1)}A.`
                    : `El desequilibrio se ha corregido a ${imbalance.toFixed(1)}%.`,
                deviceId: generalId,
                metadata: { imbalance_pct: imbalance, current_l1: i1, current_l2: i2, current_l3: i3 },
            });
        }

        // ── 3. Power > 90% contracted ──
        const powerW = parseFloat(d.power_w_total || d.power_w || 0);
        const powerKw = powerW / 1000;
        if (powerKw > 0) {
            // Get contracted power from contract
            try {
                const costService = require('./cost.service');
                const costInfo = await costService.getCurrentCostPerKwh(factoryId);
                const contractedKw = costInfo?.contracted_power_kw;

                if (contractedKw && contractedKw > 0) {
                    const usagePct = (powerKw / contractedKw) * 100;

                    await notificationService.checkAndNotify(factoryId, 'power_peak', {
                        triggered: usagePct > 90,
                        severity: usagePct > 100 ? 'critical' : 'warning',
                        title: usagePct > 90
                            ? `Potencia al ${usagePct.toFixed(0)}% del contratado`
                            : `Potencia normalizada: ${usagePct.toFixed(0)}%`,
                        message: usagePct > 90
                            ? `Consumo actual: ${powerKw.toFixed(1)} kW de ${contractedKw} kW contratados (${usagePct.toFixed(0)}%). Riesgo de penalización por exceso.`
                            : `El consumo ha bajado a ${powerKw.toFixed(1)} kW (${usagePct.toFixed(0)}% del contratado).`,
                        deviceId: generalId,
                        metadata: { power_kw: powerKw, contracted_kw: contractedKw, usage_pct: usagePct },
                    });
                }
            } catch (e) {
                // No contract configured — skip peak check
            }
        }
    } catch (err) {
        // Never break the telemetry pipeline
        console.error('[SYSTEM_EVENTS] Error checking system events:', err.message);
    }
};

/**
 * Process device status (heartbeat)
 */
const processStatusMessage = async (topic, payload) => {
    try {
        const data = JSON.parse(payload.toString());
        const factoryId = topic.split('/')[1];
        console.log(`[MQTT] Status from factory ${factoryId}:`, data);
    } catch (err) {
        console.error('[MQTT] Error processing status:', err.message);
    }
};

module.exports = { processTelemetryMessage, processRealtimeMessage, processStatusMessage };
