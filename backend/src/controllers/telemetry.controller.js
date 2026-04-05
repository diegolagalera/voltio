const db = require('../config/database');
const websocket = require('../config/websocket');
const { getFactoryTimezone, getLocalDateStr, toMidnightSQL, toNextDayMidnightSQL } = require('../utils/timezone');
const { buildTelemetryInsert, buildRealtimeUpsert } = require('../utils/telemetry-insert.helper');

/**
 * POST /api/telemetry/ingest
 * Batch ingest telemetry data from Raspberry Pi
 */
const ingest = async (req, res, next) => {
    try {
        const { readings } = req.body;
        let inserted = 0;

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            // Cache device hierarchy per batch
            const hierarchyCache = {};
            const getHierarchy = async (deviceId) => {
                if (hierarchyCache[deviceId] !== undefined) return hierarchyCache[deviceId];
                try {
                    const res = await client.query(
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
                const { device_id, device_type, timestamp, data } = reading;

                const hierarchy = await getHierarchy(device_id);

                // Insert into hypertable (shared helper — full schema)
                const insert = buildTelemetryInsert(data, hierarchy, device_id, device_type, timestamp);
                await client.query(insert.sql, insert.params);

                // Update realtime cache (shared helper)
                const upsert = buildRealtimeUpsert(device_id, device_type, data, timestamp);
                await client.query(upsert.sql, upsert.params);

                inserted++;
            }

            await client.query('COMMIT');

            // Emit via WebSocket if there are listeners
            if (readings.length > 0) {
                const factoryId = readings[0].factory_id;
                if (websocket.hasActiveListeners(factoryId)) {
                    websocket.emitTelemetry(factoryId, readings);
                }
            }

            res.json({ success: true, message: `Inserted ${inserted} readings` });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/telemetry/:deviceId/latest
 * For phase sub-devices: maps parent's L1/L2/L3 data
 */
const getLatest = async (req, res, next) => {
    try {
        const { deviceId } = req.params;
        const STALE_THRESHOLD_MINUTES = 10;

        // Check if this is a phase sub-device
        const deviceResult = await db.query(
            'SELECT parent_device_id, parent_relation, phase_channel FROM devices WHERE id = $1',
            [deviceId]
        );

        if (deviceResult.rows.length && deviceResult.rows[0].parent_relation === 'phase_channel') {
            const { parent_device_id, phase_channel } = deviceResult.rows[0];
            // Get parent's realtime data and extract this phase
            const parentResult = await db.query(
                `SELECT data, last_updated,
                 last_updated > NOW() - INTERVAL '${STALE_THRESHOLD_MINUTES} minutes' as is_fresh
                 FROM telemetry_realtime WHERE device_id = $1`,
                [parent_device_id]
            );
            if (parentResult.rows.length && parentResult.rows[0].is_fresh) {
                const parentData = parentResult.rows[0].data;
                const phaseKey = phase_channel.toLowerCase(); // 'l1', 'l2', 'l3'
                const mappedData = {
                    voltage_l1_n: parentData[`voltage_${phaseKey}_n`] || parentData[`voltage_l1_n`],
                    current_l1: parentData[`current_${phaseKey}`],
                    power_w_total: parentData[`power_w_${phaseKey}`],
                    power_va_total: parentData[`power_va_${phaseKey}`],
                    power_var_total: parentData[`power_var_${phaseKey}`],
                    power_factor: parentData[`power_factor_${phaseKey}`],
                    frequency_hz: parentData.frequency_hz,
                    energy_kwh_total: parentData[`energy_kwh_${phaseKey}`],
                };
                return res.json({
                    success: true,
                    data: {
                        device_id: deviceId,
                        data: mappedData,
                        last_updated: parentResult.rows[0].last_updated,
                    },
                });
            }
            return res.json({ success: true, data: null });
        }

        // Normal device — only return data if fresh (< 10 min)
        const result = await db.query(
            `SELECT *,
             last_updated > NOW() - INTERVAL '${STALE_THRESHOLD_MINUTES} minutes' as is_fresh
             FROM telemetry_realtime WHERE device_id = $1`,
            [deviceId]
        );

        if (result.rows.length === 0 || !result.rows[0].is_fresh) {
            return res.json({ success: true, data: null });
        }

        const { is_fresh, ...cleanRow } = result.rows[0];
        res.json({ success: true, data: cleanRow });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/telemetry/:deviceId/history
 */
const getHistory = async (req, res, next) => {
    try {
        const { deviceId } = req.params;
        const { start, end, interval } = req.query;

        let query;
        let params = [deviceId, start, end];

        if (interval === 'raw' || interval === '1m' || interval === '5m' || interval === '15m') {
            // Raw data from hypertable
            query = `
        SELECT * FROM telemetry
        WHERE device_id = $1 AND time >= $2 AND time <= $3
        ORDER BY time ASC
        LIMIT 5000
      `;
        } else if (interval === '1h') {
            // Hourly aggregates
            query = `
        SELECT * FROM telemetry_hourly
        WHERE device_id = $1 AND bucket >= $2 AND bucket <= $3
        ORDER BY bucket ASC
      `;
        } else if (interval === '1d') {
            // Daily aggregates
            query = `
        SELECT * FROM telemetry_daily
        WHERE device_id = $1 AND bucket >= $2 AND bucket <= $3
        ORDER BY bucket ASC
      `;
        }

        const result = await db.query(query, params);
        res.json({ success: true, data: result.rows, count: result.rows.length });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/telemetry/factory/:factoryId/summary
 */
const getFactorySummary = async (req, res, next) => {
    try {
        const { factoryId } = req.params;

        // Get all devices with their latest readings + hierarchy info
        const result = await db.query(
            `SELECT d.id, d.name, d.device_type, d.serial_number,
              d.device_role, d.parent_device_id, d.parent_relation, d.phase_channel,
              d.host,
              tr.data as latest_data, tr.last_updated,
              d.is_active
       FROM devices d
       LEFT JOIN telemetry_realtime tr ON d.id = tr.device_id
       WHERE d.factory_id = $1 AND d.is_active = true
       ORDER BY d.device_type DESC, d.name`,
            [factoryId]
        );

        // For phase sub-devices, map parent's L1/L2/L3 into their latest_data
        const devicesById = {};
        for (const d of result.rows) {
            devicesById[d.id] = d;
        }
        for (const d of result.rows) {
            if (d.parent_relation === 'phase_channel' && d.parent_device_id) {
                const parent = devicesById[d.parent_device_id];
                if (parent && parent.latest_data) {
                    const pd = parent.latest_data;
                    const phaseKey = d.phase_channel.toLowerCase();
                    d.latest_data = {
                        voltage_l1_n: pd[`voltage_${phaseKey}_n`] || pd.voltage_l1_n,
                        current_l1: pd[`current_${phaseKey}`],
                        power_w_total: pd[`power_w_${phaseKey}`],
                        power_va_total: pd[`power_va_${phaseKey}`],
                        power_var_total: pd[`power_var_${phaseKey}`],
                        power_factor: pd[`power_factor_${phaseKey}`],
                        frequency_hz: pd.frequency_hz,
                        energy_kwh_total: pd[`energy_kwh_${phaseKey}`],
                    };
                    d.last_updated = parent.last_updated;
                }
            }
        }

        // For downstream parents, calculate net consumption
        for (const d of result.rows) {
            if (d.latest_data && !d.parent_device_id) {
                // Find downstream children
                const downstreamChildren = result.rows.filter(
                    c => c.parent_device_id === d.id && c.parent_relation === 'downstream'
                );
                if (downstreamChildren.length > 0) {
                    const grossPower = parseFloat(d.latest_data.power_w_total || d.latest_data.power_w || 0);
                    const childPower = downstreamChildren.reduce((sum, c) => {
                        return sum + parseFloat(c.latest_data?.power_w_total || c.latest_data?.power_w || 0);
                    }, 0);
                    d.latest_data._net_power_w = grossPower - childPower;
                    d.latest_data._gross_power_w = grossPower;
                    d.latest_data._has_downstream = true;
                }
            }
        }

        // Get today's energy summary (use factory timezone for correct "today")
        const tz = await getFactoryTimezone(factoryId);
        const today = getLocalDateStr(tz);
        const dayStartExpr = toMidnightSQL('$2', tz);
        const dayEndExpr = toNextDayMidnightSQL('$2', tz);
        const energyResult = await db.query(
            `SELECT
         d.id as device_id,
         d.name as device_name,
         COALESCE(SUM(th.delta_kwh), 0) as today_kwh
       FROM devices d
       LEFT JOIN telemetry_hourly th ON d.id = th.device_id
         AND th.bucket >= ${dayStartExpr} AND th.bucket < ${dayEndExpr}
       WHERE d.factory_id = $1 AND d.is_active = true
       GROUP BY d.id, d.name`,
            [factoryId, today]
        );

        // Post-process: estimate energy_today for phase sub-devices
        // Phase devices don't have their own telemetry_hourly rows,
        // so we estimate from parent's energy × (phase_power / total_power)
        const energyMap = {};
        for (const row of energyResult.rows) {
            energyMap[row.device_id] = row;
        }

        for (const d of result.rows) {
            if (d.parent_relation === 'phase_channel' && d.parent_device_id) {
                const parentEnergy = energyMap[d.parent_device_id];
                const parentDevice = devicesById[d.parent_device_id];
                const parentKwh = parseFloat(parentEnergy?.today_kwh || 0);

                if (parentKwh > 0 && parentDevice?.latest_data && d.latest_data) {
                    const totalPower = parseFloat(parentDevice.latest_data.power_w_total || parentDevice.latest_data.power_w || 0);
                    const phasePower = parseFloat(d.latest_data.power_w_total || d.latest_data.power_w || 0);

                    // Ratio-based estimation (safe division)
                    const ratio = totalPower > 0 ? phasePower / totalPower : 0;
                    const estimatedKwh = parentKwh * ratio;

                    // Update the energy_today entry for this phase
                    if (energyMap[d.id]) {
                        energyMap[d.id].today_kwh = estimatedKwh.toFixed(3);
                        energyMap[d.id].estimated = true;
                    } else {
                        energyResult.rows.push({
                            device_id: d.id,
                            device_name: d.name,
                            today_kwh: estimatedKwh.toFixed(3),
                            estimated: true,
                        });
                    }
                }
            }
        }

        res.json({
            success: true,
            data: {
                devices: result.rows,
                energy_today: energyResult.rows,
            },
        });
    } catch (err) {
        next(err);
    }
};

module.exports = { ingest, getLatest, getHistory, getFactorySummary };
