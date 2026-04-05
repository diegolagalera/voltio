/**
 * FPSaver — Report Service
 * Generates aggregated reports for historical energy analysis.
 * 
 * Table schemas:
 *   - cost_snapshots: id, factory_id, contract_id, timestamp, period, price_kwh, 
 *                     kwh_consumed, cost_eur, pricing_model, spot_price, breakdown
 *   - telemetry:      time, device_id, device_type, power_w_total, power_w_l1..l3, 
 *                     voltage_l1_n..l3_n, current_l1..l3, power_factor, etc.
 *   - telemetry_realtime: device_id, device_type, data (JSONB), last_updated
 */

const db = require('../config/database');
const costService = require('./cost.service');
const { PERIOD_COLORS, PERIOD_LABELS } = require('../utils/period-resolver');
const { getFactoryTimezone } = require('../utils/timezone');

/**
 * Summary KPIs for a date range
 */
const getSummary = async (factoryId, from, to) => {
    try {
        // Determine if this is a single-day query
        const fromDate = new Date(from);
        const toDate = new Date(to);
        const isSingleDay = (toDate - fromDate) < 86400000 * 1.5; // less than ~1.5 days

        let totalCost = 0;
        let totalKwh = 0;
        let snapshotCount = 0;

        if (isSingleDay) {
            // Single day: use LIVE telemetry calculation (same as real-time dashboard)
            // This ensures reports and real-time always show identical values
            try {
                // Extract date from the 'from' string (e.g. "2026-03-10T00:00:00+01:00" → "2026-03-10")
                // Do NOT use toISOString() as it shifts to UTC (would give "2026-03-09")
                const dateStr = from.split('T')[0];
                const dailyData = await costService.getDailyCostBreakdown(factoryId, dateStr);
                totalCost = dailyData.total_cost || 0;
                totalKwh = dailyData.total_kwh || 0;
                snapshotCount = dailyData.hours?.filter(h => h.kwh > 0).length || 0;
            } catch (e) {
                console.warn('[Report] getDailyCostBreakdown failed, falling back to snapshots:', e.message);
            }
        }

        // Multi-day or fallback: use cost_snapshots
        if (!isSingleDay || (totalKwh === 0 && totalCost === 0)) {
            const costResult = await db.query(`
                SELECT 
                    COALESCE(SUM(cost_eur), 0) AS total_cost,
                    COALESCE(SUM(kwh_consumed), 0) AS total_kwh,
                    COUNT(*) AS snapshot_count
                FROM cost_snapshots
                WHERE factory_id = $1
                AND timestamp >= $2::timestamptz
                AND timestamp < $3::timestamptz
            `, [factoryId, from, to]);
            const row = costResult.rows[0];
            totalCost = parseFloat(row.total_cost) || 0;
            totalKwh = parseFloat(row.total_kwh) || 0;
            snapshotCount = parseInt(row.snapshot_count);
        }

        // Peak power — HYBRID: take MAX from both general meter AND sub-meter sum
        // Ensures we capture peaks even if general meter was installed mid-period
        let peakKw = 0;
        try {
            const generalDevice = await db.query(
                `SELECT id FROM devices WHERE factory_id = $1 AND device_role = 'general_meter' AND is_active = true LIMIT 1`,
                [factoryId]
            );

            // Peak from general meter (if exists)
            let peakGeneral = 0;
            if (generalDevice.rows.length > 0) {
                const r = await db.query(`
                    SELECT COALESCE(MAX(power_w_total), 0) / 1000 AS peak_kw
                    FROM telemetry
                    WHERE device_id = $1 AND time >= $2::timestamptz AND time < $3::timestamptz
                `, [generalDevice.rows[0].id, from, to]);
                peakGeneral = parseFloat(r.rows[0]?.peak_kw) || 0;
            }

            // Peak from sub-meter sum (always query — covers hours without general meter)
            let peakSubMeters = 0;
            const subResult = await db.query(`
                SELECT MAX(bucket_kw) AS peak_kw FROM (
                    SELECT time_bucket('5 minutes', t.time) AS bucket,
                           SUM(t.power_w_total) / 1000 AS bucket_kw
                    FROM telemetry t
                    JOIN devices d ON d.id = t.device_id
                    WHERE d.factory_id = $1 AND d.is_active = true
                      AND d.device_role IS DISTINCT FROM 'general_meter'
                      AND d.parent_relation IS DISTINCT FROM 'phase_channel'
                      AND d.parent_relation IS DISTINCT FROM 'downstream'
                    AND t.time >= $2::timestamptz AND t.time < $3::timestamptz
                    GROUP BY bucket
                ) sub
            `, [factoryId, from, to]);
            peakSubMeters = parseFloat(subResult.rows[0]?.peak_kw) || 0;

            // Take the greater peak — best available data
            peakKw = Math.max(peakGeneral, peakSubMeters);
        } catch (e) {
            console.error('[Report] Peak power query failed:', e.message);
        }

        // Get contracted power
        let contractedPower = 0;
        try {
            const contract = await costService.getActiveContract(factoryId);
            contractedPower = contract ? parseFloat(contract.power_p1_kw) || 0 : 0;
        } catch (e) { /* ignore */ }

        return {
            total_cost: Math.round(totalCost * 100) / 100,
            total_kwh: Math.round(totalKwh * 100) / 100,
            avg_price_kwh: totalKwh > 0
                ? Math.round((totalCost / totalKwh) * 10000) / 10000
                : 0,
            peak_kw: Math.round(peakKw * 10) / 10,
            peak_time: null,
            contracted_power_kw: contractedPower,
            snapshot_count: snapshotCount,
        };
    } catch (err) {
        console.error('[Report] getSummary error:', err.message);
        return {
            total_cost: 0, total_kwh: 0, avg_price_kwh: 0,
            peak_kw: 0, peak_time: null, contracted_power_kw: 0, snapshot_count: 0,
        };
    }
};

/**
 * Cost grouped by period and time bucket
 */
const getCostByPeriod = async (factoryId, from, to, groupBy = 'day') => {
    try {
        // Determine if this is a single-day query
        const fromDate = new Date(from);
        const toDate = new Date(to);
        const isSingleDay = (toDate - fromDate) < 86400000 * 1.5;

        const bucketMap = new Map();

        if (isSingleDay) {
            // Single day: use LIVE telemetry calculation (same as real-time dashboard)
            try {
                const dateStr = from.split('T')[0];
                const daily = await costService.getDailyCostBreakdown(factoryId, dateStr);
                if (daily.hours) {
                    for (const h of daily.hours) {
                        // Build local ISO string for the hour bucket
                        const key = `${dateStr}T${String(h.hour).padStart(2, '0')}:00:00`;
                        bucketMap.set(key, {
                            bucket: key,
                            [h.period]: h.cost,
                            [`${h.period}_kwh`]: h.kwh,
                            total: h.cost,
                            total_kwh: h.kwh,
                        });
                    }
                }
            } catch (e) {
                console.warn('[Report] getCostByPeriod live fallback failed:', e.message);
            }
        }

        // Multi-day or fallback: use cost_snapshots
        if (!isSingleDay || bucketMap.size === 0) {
            const tz = await getFactoryTimezone(factoryId);
            const bucket = groupBy === 'hour' ? '1 hour' : '1 day';
            const result = await db.query(`
                SELECT 
                    time_bucket('${bucket}', timestamp, '${tz}') AS bucket,
                    period,
                    SUM(cost_eur) AS cost,
                    SUM(kwh_consumed) AS kwh
                FROM cost_snapshots
                WHERE factory_id = $1
                AND timestamp >= $2::timestamptz
                AND timestamp < $3::timestamptz
                GROUP BY bucket, period
                ORDER BY bucket
            `, [factoryId, from, to]);

            // Format dates in local timezone to avoid UTC shift in bucket labels
            const toLocalISO = (d) => {
                const pad = n => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            };

            for (const row of result.rows) {
                const key = toLocalISO(row.bucket);
                if (!bucketMap.has(key)) {
                    bucketMap.set(key, { bucket: key, total: 0, total_kwh: 0 });
                }
                const entry = bucketMap.get(key);
                const period = row.period || 'P3';
                entry[period] = Math.round(parseFloat(row.cost) * 100) / 100;
                entry[`${period}_kwh`] = Math.round(parseFloat(row.kwh) * 100) / 100;
                entry.total += parseFloat(row.cost);
                entry.total_kwh += parseFloat(row.kwh);
            }
        }

        return {
            data: Array.from(bucketMap.values()),
            period_colors: PERIOD_COLORS,
            period_labels: PERIOD_LABELS,
        };
    } catch (err) {
        console.error('[Report] getCostByPeriod error:', err.message);
        return { data: [], period_colors: PERIOD_COLORS, period_labels: PERIOD_LABELS };
    }
};

/**
 * Power demand time series
 * Uses the telemetry hypertable (actual columns, not JSONB)
 */
const getPowerDemand = async (factoryId, from, to) => {
    let contractedPowers = {};
    let maxContracted = 0;

    try {
        const contract = await costService.getActiveContract(factoryId);
        if (contract) {
            for (let i = 1; i <= 6; i++) {
                contractedPowers[`P${i}`] = parseFloat(contract[`power_p${i}_kw`]) || 0;
            }
            maxContracted = Math.max(...Object.values(contractedPowers).filter(v => v > 0), 0);
        }
    } catch (e) { /* ignore */ }

    try {
        // HYBRID power demand: query both sources and merge per hour
        // For each hour: prefer general meter data, fall back to sub-meter sum
        const generalDevice = await db.query(
            `SELECT id FROM devices WHERE factory_id = $1 AND device_role = 'general_meter' AND is_active = true LIMIT 1`,
            [factoryId]
        );

        const tz = await getFactoryTimezone(factoryId);

        // 1. General meter hourly data
        const gmHourly = {};
        if (generalDevice.rows.length > 0) {
            const gmResult = await db.query(`
                SELECT 
                    time_bucket('1 hour', t.time, '${tz}') AS hour,
                    COALESCE(AVG(t.power_w_total), 0) / 1000 AS avg_kw,
                    COALESCE(MAX(t.power_w_total), 0) / 1000 AS max_kw
                FROM telemetry t
                WHERE t.device_id = $1
                AND t.time >= $2::timestamptz
                AND t.time < $3::timestamptz
                GROUP BY hour
            `, [generalDevice.rows[0].id, from, to]);
            for (const r of gmResult.rows) {
                gmHourly[String(r.hour)] = {
                    avg_kw: parseFloat(r.avg_kw) || 0,
                    max_kw: parseFloat(r.max_kw) || 0,
                };
            }
        }

        // 2. Sub-meter sum hourly data (always query — covers hours without general meter)
        const smHourly = {};
        const smResult = await db.query(`
            SELECT 
                sub.hour,
                SUM(sub.avg_pw) / 1000 AS avg_kw,
                MAX(sub.max_pw) / 1000 AS max_kw
            FROM (
                SELECT 
                    time_bucket('1 hour', t.time, '${tz}') AS hour,
                    t.device_id,
                    AVG(t.power_w_total) AS avg_pw,
                    MAX(t.power_w_total) AS max_pw
                FROM telemetry t
                JOIN devices d ON d.id = t.device_id
                WHERE d.factory_id = $1 AND d.is_active = true
                  AND d.device_role IS DISTINCT FROM 'general_meter'
                  AND d.parent_relation IS DISTINCT FROM 'phase_channel'
                  AND d.parent_relation IS DISTINCT FROM 'downstream'
                AND t.time >= $2::timestamptz
                AND t.time < $3::timestamptz
                GROUP BY hour, t.device_id
            ) sub
            GROUP BY sub.hour
        `, [factoryId, from, to]);
        for (const r of smResult.rows) {
            smHourly[String(r.hour)] = {
                avg_kw: parseFloat(r.avg_kw) || 0,
                max_kw: parseFloat(r.max_kw) || 0,
            };
        }

        // 3. Merge: prefer general meter, fall back to sub-meter sum
        // Build a complete hourly timeline (no gaps) so chart lines drop to 0
        const fromDate = new Date(from);
        const toDate = new Date(to);
        const allHoursSet = new Set([...Object.keys(gmHourly), ...Object.keys(smHourly)]);

        // Generate every hour between from and to
        const fullTimeline = [];
        const cursor = new Date(fromDate);
        cursor.setMinutes(0, 0, 0);
        while (cursor < toDate) {
            // Check if data exists for this hour
            let matched = null;
            for (const k of allHoursSet) {
                if (new Date(k).getTime() === cursor.getTime()) {
                    matched = k;
                    break;
                }
            }
            if (matched) {
                const gm = gmHourly[matched];
                const sm = smHourly[matched];
                const source = gm || sm;
                fullTimeline.push({
                    time: matched,
                    avg_kw: Math.round((source?.avg_kw || 0) * 10) / 10,
                    max_kw: Math.round((source?.max_kw || 0) * 10) / 10,
                });
            } else {
                // No data for this hour → explicit 0 (use same format as DB timestamps)
                fullTimeline.push({
                    time: String(new Date(cursor)),
                    avg_kw: 0,
                    max_kw: 0,
                });
            }
            cursor.setHours(cursor.getHours() + 1);
        }

        // Per-device power curves (top 5 by avg power, exclude general meter)
        let perDevice = [];
        try {
            const devResult = await db.query(`
                SELECT 
                    d.id AS device_id,
                    d.name AS device_name,
                    COALESCE(AVG(t.power_w_total), 0) / 1000 AS overall_avg_kw
                FROM devices d
                JOIN telemetry t ON t.device_id = d.id
                    AND t.time >= $2::timestamptz
                    AND t.time < $3::timestamptz
                WHERE d.factory_id = $1 AND d.is_active = true
                    AND d.device_role IS DISTINCT FROM 'general_meter'
                    AND d.parent_relation IS DISTINCT FROM 'phase_channel'
                GROUP BY d.id, d.name
                ORDER BY overall_avg_kw DESC
                LIMIT 5
            `, [factoryId, from, to]);

            const topDeviceIds = devResult.rows.map(r => r.device_id);

            if (topDeviceIds.length > 0) {
                const curvesResult = await db.query(`
                    SELECT 
                        t.device_id,
                        time_bucket('1 hour', t.time, '${tz}') AS hour,
                        COALESCE(AVG(t.power_w_total), 0) / 1000 AS avg_kw,
                        COALESCE(MAX(t.power_w_total), 0) / 1000 AS max_kw
                    FROM telemetry t
                    WHERE t.device_id = ANY($1)
                    AND t.time >= $2::timestamptz
                    AND t.time < $3::timestamptz
                    GROUP BY t.device_id, hour
                    ORDER BY hour
                `, [topDeviceIds, from, to]);

                // Group by device, build time-indexed map per device
                const deviceMap = {};
                for (const r of devResult.rows) {
                    deviceMap[r.device_id] = {
                        device_id: r.device_id,
                        device_name: r.device_name,
                        _timeMap: {}, // temp: time -> data
                    };
                }
                for (const r of curvesResult.rows) {
                    if (deviceMap[r.device_id]) {
                        deviceMap[r.device_id]._timeMap[new Date(r.hour).getTime()] = {
                            avg_kw: Math.round(parseFloat(r.avg_kw || 0) * 10) / 10,
                            max_kw: Math.round(parseFloat(r.max_kw || 0) * 10) / 10,
                        };
                    }
                }

                // Fill all hours for each device (0 for missing)
                for (const dev of Object.values(deviceMap)) {
                    dev.data = [];
                    const devCursor = new Date(fromDate);
                    devCursor.setMinutes(0, 0, 0);
                    while (devCursor < toDate) {
                        const ts = devCursor.getTime();
                        const entry = dev._timeMap[ts];
                        dev.data.push({
                            time: entry ? String(new Date(ts)) : String(new Date(devCursor)),
                            avg_kw: entry ? entry.avg_kw : 0,
                            max_kw: entry ? entry.max_kw : 0,
                        });
                        devCursor.setHours(devCursor.getHours() + 1);
                    }
                    delete dev._timeMap;
                }
                perDevice = Object.values(deviceMap);
            }
        } catch (e) {
            console.warn('[Report] Per-device power curves failed:', e.message);
        }

        return {
            data: fullTimeline,
            per_device: perDevice,
            contracted_powers: contractedPowers,
            max_contracted: maxContracted,
        };
    } catch (err) {
        console.error('[Report] getPowerDemand error:', err.message);
        return { data: [], per_device: [], contracted_powers: contractedPowers, max_contracted: maxContracted };
    }
};

/**
 * Per-device cost breakdown using HISTORICAL telemetry data.
 * 
 * Includes ALL devices (phases, downstream) with hierarchy metadata.
 * Uses denormalized parent_device_id/parent_relation from telemetry rows
 * for accurate historical hierarchy reconstruction.
 */
const getDeviceBreakdown = async (factoryId, from, to) => {
    try {
        // 1. Get avg price and total cost
        // Single-day: use LIVE calculation (same as real-time)
        // Multi-day: use cost_snapshots
        const fromDate = new Date(from);
        const toDate = new Date(to);
        const isSingleDay = (toDate - fromDate) < 86400000 * 1.5;

        let totalCostEur = 0;
        let totalKwh = 0;
        let avgPrice = 0.20;

        if (isSingleDay) {
            try {
                const dateStr = from.split('T')[0];
                const dailyData = await costService.getDailyCostBreakdown(factoryId, dateStr);
                totalCostEur = dailyData.total_cost || 0;
                totalKwh = dailyData.total_kwh || 0;
                avgPrice = totalKwh > 0 ? totalCostEur / totalKwh : 0.20;
            } catch (e) {
                console.warn('[Report] getDeviceBreakdown live cost failed:', e.message);
            }
        }

        // Multi-day or fallback: use cost_snapshots
        if (!isSingleDay || (totalCostEur === 0 && totalKwh === 0)) {
            try {
                const costResult = await db.query(`
                    SELECT 
                        COALESCE(SUM(cost_eur), 0) AS total_cost,
                        COALESCE(SUM(kwh_consumed), 0) AS total_kwh,
                        CASE WHEN SUM(kwh_consumed) > 0 
                            THEN SUM(cost_eur) / SUM(kwh_consumed)
                            ELSE 0.20 
                        END AS avg_price
                    FROM cost_snapshots
                    WHERE factory_id = $1
                    AND timestamp >= $2::timestamptz
                    AND timestamp < $3::timestamptz
                `, [factoryId, from, to]);
                totalCostEur = parseFloat(costResult.rows[0]?.total_cost) || 0;
                totalKwh = parseFloat(costResult.rows[0]?.total_kwh) || 0;
                avgPrice = parseFloat(costResult.rows[0]?.avg_price) || 0.20;
            } catch (e) { /* ignore */ }
        }

        // 2. Get ALL historical hierarchy events (not just snapshot-at-end)
        //    This allows us to split time ranges per attach/detach interval
        const allHierarchyResult = await db.query(`
            SELECT device_id, parent_device_id, parent_relation, phase_channel, action, timestamp
            FROM device_hierarchy_log
            WHERE timestamp <= $1
            ORDER BY device_id, timestamp
        `, [to]);

        // Build time-interval map per device:
        // { device_id: [ { parent_id, relation, phase, from, to }, ... ] }
        const deviceIntervals = {};
        const eventsByDevice = {};
        for (const row of allHierarchyResult.rows) {
            if (!eventsByDevice[row.device_id]) eventsByDevice[row.device_id] = [];
            eventsByDevice[row.device_id].push(row);
        }

        for (const [devId, events] of Object.entries(eventsByDevice)) {
            const intervals = [];
            let currentAttach = null;

            for (const ev of events) {
                if (ev.action === 'attached') {
                    currentAttach = {
                        parent_device_id: ev.parent_device_id,
                        parent_relation: ev.parent_relation,
                        phase_channel: ev.phase_channel,
                        from: new Date(ev.timestamp),
                    };
                } else if (ev.action === 'detached' && currentAttach) {
                    currentAttach.to = new Date(ev.timestamp);
                    intervals.push(currentAttach);
                    currentAttach = null;
                }
            }

            // If still attached at end (no detach), close interval at query 'to'
            if (currentAttach) {
                currentAttach.to = new Date(to);
                intervals.push(currentAttach);
            }

            // Only keep intervals that overlap with our query range [from, to)
            const queryFrom = new Date(from);
            const queryTo = new Date(to);
            deviceIntervals[devId] = intervals
                .filter(iv => iv.to > queryFrom && iv.from < queryTo)
                .map(iv => ({
                    ...iv,
                    from: iv.from < queryFrom ? queryFrom : iv.from,
                    to: iv.to > queryTo ? queryTo : iv.to,
                }));
        }

        // Helper: determine the effective hierarchy for a device over the full range
        // Returns the last known state for grouping purposes, plus interval data
        const getEffectiveHierarchy = (deviceId) => {
            const intervals = deviceIntervals[deviceId];
            if (!intervals || intervals.length === 0) return null;
            // Return the last interval's info (for grouping/display)
            const last = intervals[intervals.length - 1];
            if (last.to >= new Date(to)) {
                // Still attached at end of range
                return {
                    parent_device_id: last.parent_device_id,
                    parent_relation: last.parent_relation,
                    phase_channel: last.phase_channel,
                    intervals,
                };
            }
            return null; // Detached before end → treated as standalone
        };

        // Build hierarchyAtTime (for backward compat with grouping logic)
        const hierarchyAtTime = {};
        for (const [devId, intervals] of Object.entries(deviceIntervals)) {
            const eff = getEffectiveHierarchy(devId);
            if (eff) {
                hierarchyAtTime[devId] = eff;
            }
        }

        // 3. Get avg power per device (full range — used for standalone devices)
        const result = await db.query(`
            SELECT 
                d.id AS device_id,
                d.name AS device_name,
                d.device_type,
                d.device_role,
                d.phase_channel,
                d.created_at AS device_created_at,
                COALESCE(AVG(t.power_w_total), 0) / 1000 AS avg_kw,
                COUNT(t.*) AS samples
            FROM devices d
            LEFT JOIN telemetry t ON t.device_id = d.id
                AND t.time >= $2::timestamptz
                AND t.time < $3::timestamptz
            WHERE d.factory_id = $1 AND d.is_active = true
            GROUP BY d.id, d.name, d.device_type, d.device_role, 
                     d.phase_channel, d.created_at
            ORDER BY avg_kw DESC
        `, [factoryId, from, to]);

        const rangeHours = Math.max(1, Math.round((new Date(to) - new Date(from)) / 3600000));
        const BATCH_INTERVAL_SEC = 300;

        let generalMeterKwh = 0;
        let generalMeterKw = 0;
        const allDevices = [];

        // 4. For downstream devices with intervals, calculate kWh only during attached periods
        //    This is the key fix: instead of using full-range kWh, we query per-interval
        const intervalKwhCache = {}; // { "deviceId|from|to": kwhValue }

        const getIntervalKwh = async (deviceId, ivFrom, ivTo) => {
            const cacheKey = `${deviceId}|${ivFrom.toISOString()}|${ivTo.toISOString()}`;
            if (intervalKwhCache[cacheKey] !== undefined) return intervalKwhCache[cacheKey];

            const ivResult = await db.query(`
                SELECT COALESCE(AVG(power_w_total), 0) / 1000 AS avg_kw, COUNT(*) AS samples
                FROM telemetry
                WHERE device_id = $1
                  AND time >= $2::timestamptz AND time < $3::timestamptz
            `, [deviceId, ivFrom.toISOString(), ivTo.toISOString()]);

            const r = ivResult.rows[0];
            const avgKw = parseFloat(r?.avg_kw) || 0;
            const samples = parseInt(r?.samples) || 0;
            const hours = samples > 0 ? (samples * BATCH_INTERVAL_SEC) / 3600 : 0;
            const kwh = Math.round(avgKw * hours * 100) / 100;

            intervalKwhCache[cacheKey] = kwh;
            return kwh;
        };

        for (const r of result.rows) {
            const avgKw = parseFloat(r.avg_kw) || 0;
            const samples = parseInt(r.samples) || 0;
            const actualHours = samples > 0 ? (samples * BATCH_INTERVAL_SEC) / 3600 : 0;
            const kwh = Math.round(avgKw * actualHours * 100) / 100;
            const isGeneralMeter = r.device_role === 'general_meter';
            const hasTelemetryData = samples > 0;

            // Historical hierarchy
            const hist = hierarchyAtTime[r.device_id];
            const parentId = hist?.parent_device_id || null;
            const parentRelation = hist?.parent_relation || null;

            // SKIP downstream with no telemetry
            if (!hasTelemetryData && parentRelation === 'downstream') continue;

            if (isGeneralMeter) {
                generalMeterKw = Math.round(avgKw * 100) / 100;
                generalMeterKwh = kwh;
            }

            allDevices.push({
                device_id: r.device_id,
                device_name: r.device_name,
                device_type: r.device_type,
                device_role: r.device_role,
                parent_device_id: parentId,
                parent_relation: parentRelation,
                phase_channel: hist?.phase_channel || r.phase_channel,
                avg_kw: Math.round(avgKw * 100) / 100,
                kwh,
                is_general_meter: isGeneralMeter,
                _actualHours: actualHours,
                _intervals: hist?.intervals || null,
            });
        }

        // Reference total
        const refTotalKwh = totalKwh > 0 ? totalKwh : generalMeterKwh;
        const refTotalCost = totalCostEur > 0 ? totalCostEur : (generalMeterKwh * avgPrice);

        // Find phase child devices
        const phaseDevices = allDevices.filter(d => d.parent_relation === 'phase_channel');

        // Query per-phase power from PARENT's telemetry
        const phaseDataByParent = {};
        const parentIdsWithPhases = [...new Set(phaseDevices.map(p => p.parent_device_id).filter(Boolean))];

        if (parentIdsWithPhases.length > 0) {
            try {
                // For phase devices with intervals, query per-interval
                for (const parentId of parentIdsWithPhases) {
                    const phaseChildren = phaseDevices.filter(p => p.parent_device_id === parentId);
                    // Determine intervals — merge all phase children intervals for this parent
                    const hasIntervals = phaseChildren.some(pc => pc._intervals && pc._intervals.length > 0);

                    if (hasIntervals) {
                        // Use intervals — query per interval and accumulate
                        const accumulated = { L1: 0, L2: 0, L3: 0, hours_L1: 0, hours_L2: 0, hours_L3: 0 };
                        const intervals = phaseChildren[0]._intervals || [];

                        for (const iv of intervals) {
                            const phaseResult = await db.query(`
                                SELECT 
                                    COALESCE(AVG(power_w_l1), 0) / 1000 AS avg_kw_l1,
                                    COALESCE(AVG(power_w_l2), 0) / 1000 AS avg_kw_l2,
                                    COALESCE(AVG(power_w_l3), 0) / 1000 AS avg_kw_l3,
                                    COUNT(power_w_l1) AS samples_l1,
                                    COUNT(power_w_l2) AS samples_l2,
                                    COUNT(power_w_l3) AS samples_l3
                                FROM telemetry
                                WHERE device_id = $1
                                AND time >= $2::timestamptz AND time < $3::timestamptz
                            `, [parentId, iv.from.toISOString(), iv.to.toISOString()]);

                            const r = phaseResult.rows[0];
                            if (r) {
                                const s1 = parseInt(r.samples_l1) || 0;
                                const s2 = parseInt(r.samples_l2) || 0;
                                const s3 = parseInt(r.samples_l3) || 0;
                                const h1 = s1 * BATCH_INTERVAL_SEC / 3600;
                                const h2 = s2 * BATCH_INTERVAL_SEC / 3600;
                                const h3 = s3 * BATCH_INTERVAL_SEC / 3600;
                                // Weighted accumulation: avg_kw × hours for each interval
                                accumulated.L1 += (parseFloat(r.avg_kw_l1) || 0) * h1;
                                accumulated.L2 += (parseFloat(r.avg_kw_l2) || 0) * h2;
                                accumulated.L3 += (parseFloat(r.avg_kw_l3) || 0) * h3;
                                accumulated.hours_L1 += h1;
                                accumulated.hours_L2 += h2;
                                accumulated.hours_L3 += h3;
                            }
                        }

                        // Convert accumulated kWh back to avg_kw (for display)
                        phaseDataByParent[parentId] = {
                            L1: accumulated.hours_L1 > 0 ? Math.round((accumulated.L1 / accumulated.hours_L1) * 100) / 100 : 0,
                            L2: accumulated.hours_L2 > 0 ? Math.round((accumulated.L2 / accumulated.hours_L2) * 100) / 100 : 0,
                            L3: accumulated.hours_L3 > 0 ? Math.round((accumulated.L3 / accumulated.hours_L3) * 100) / 100 : 0,
                            hours_L1: accumulated.hours_L1,
                            hours_L2: accumulated.hours_L2,
                            hours_L3: accumulated.hours_L3,
                            // Store kWh directly for exact per-interval totals
                            kwh_L1: Math.round(accumulated.L1 * 100) / 100,
                            kwh_L2: Math.round(accumulated.L2 * 100) / 100,
                            kwh_L3: Math.round(accumulated.L3 * 100) / 100,
                        };
                    } else {
                        // No intervals — query full range (standard behavior)
                        const phaseResult = await db.query(`
                            SELECT 
                                COALESCE(AVG(power_w_l1), 0) / 1000 AS avg_kw_l1,
                                COALESCE(AVG(power_w_l2), 0) / 1000 AS avg_kw_l2,
                                COALESCE(AVG(power_w_l3), 0) / 1000 AS avg_kw_l3,
                                COUNT(power_w_l1) AS samples_l1,
                                COUNT(power_w_l2) AS samples_l2,
                                COUNT(power_w_l3) AS samples_l3
                            FROM telemetry
                            WHERE device_id = $1
                            AND time >= $2::timestamptz AND time < $3::timestamptz
                        `, [parentId, from, to]);

                        const r = phaseResult.rows[0];
                        if (r && (parseInt(r.samples_l1) > 0)) {
                            phaseDataByParent[parentId] = {
                                L1: Math.round(parseFloat(r.avg_kw_l1) * 100) / 100,
                                L2: Math.round(parseFloat(r.avg_kw_l2) * 100) / 100,
                                L3: Math.round(parseFloat(r.avg_kw_l3) * 100) / 100,
                                hours_L1: (parseInt(r.samples_l1) || 0) * BATCH_INTERVAL_SEC / 3600,
                                hours_L2: (parseInt(r.samples_l2) || 0) * BATCH_INTERVAL_SEC / 3600,
                                hours_L3: (parseInt(r.samples_l3) || 0) * BATCH_INTERVAL_SEC / 3600,
                            };
                        }
                    }
                }
            } catch (e) {
                console.warn('[Report] Phase power query failed:', e.message);
            }
        }

        // Build grouped result: parents with nested children
        // Use historical hierarchy from device_hierarchy_log
        const downstreamDevices = allDevices.filter(d =>
            d.parent_relation === 'downstream'
        );
        const downstreamDeviceIds = new Set(downstreamDevices.map(d => d.device_id));

        // PHASES: Already filtered above by created_at
        const phaseDeviceIds = new Set(phaseDevices.map(d => d.device_id));

        // Parent devices = not general meter, not a downstream child, not a phase child
        const parentDeviceList = allDevices.filter(d =>
            !d.is_general_meter &&
            !downstreamDeviceIds.has(d.device_id) &&
            !phaseDeviceIds.has(d.device_id)
        );

        const groupedDevices = [];
        for (const parent of parentDeviceList) {
            // Downstream children for this parent (from historical hierarchy)
            const downstream = [];
            let downstreamTotalKwh = 0;
            
            for (const ds of downstreamDevices.filter(d => d.parent_device_id === parent.device_id)) {
                // Key fix: calculate kWh only during attached intervals
                let dsKwhForNet = ds.kwh; // default: full range kWh

                if (ds._intervals && ds._intervals.length > 0) {
                    // Sum kWh across all intervals where this device was attached to this parent
                    let intervalSum = 0;
                    for (const iv of ds._intervals) {
                        if (iv.parent_device_id === parent.device_id) {
                            intervalSum += await getIntervalKwh(ds.device_id, iv.from, iv.to);
                        }
                    }
                    dsKwhForNet = intervalSum;
                }

                downstream.push({
                    ...ds,
                    parent_relation: 'downstream',
                    kwh_during_attachment: dsKwhForNet,
                    cost_eur: Math.round(ds.kwh * avgPrice * 100) / 100,
                    pct: refTotalKwh > 0 ? Math.round((ds.kwh / refTotalKwh) * 1000) / 10 : 0,
                });
                downstreamTotalKwh += dsKwhForNet;
            }

            // Phase children (from parent's L1/L2/L3 columns)
            const parentPhaseData = phaseDataByParent[parent.device_id];
            const phases = [];
            if (parentPhaseData) {
                const phaseChildren = phaseDevices.filter(p => p.parent_device_id === parent.device_id);
                for (const pc of phaseChildren) {
                    const ch = pc.phase_channel; // 'L1', 'L2', 'L3'
                    const phaseAvgKw = parentPhaseData[ch] || 0;
                    // Use precomputed kWh if available (from interval accumulation)
                    const phaseKwh = parentPhaseData[`kwh_${ch}`] != null
                        ? parentPhaseData[`kwh_${ch}`]
                        : Math.round(phaseAvgKw * (parentPhaseData[`hours_${ch}`] || 0) * 100) / 100;
                    phases.push({
                        device_id: pc.device_id,
                        device_name: pc.device_name,
                        device_type: pc.device_type,
                        phase_channel: ch,
                        parent_relation: 'phase_channel',
                        avg_kw: phaseAvgKw,
                        kwh: phaseKwh,
                        cost_eur: Math.round(phaseKwh * avgPrice * 100) / 100,
                        pct: refTotalKwh > 0 ? Math.round((phaseKwh / refTotalKwh) * 1000) / 10 : 0,
                    });
                }
                phases.sort((a, b) => (a.phase_channel || '').localeCompare(b.phase_channel || ''));
            }

            // Parent's NET consumption = gross minus downstream kWh DURING ATTACHMENT
            const parentKwhNet = Math.max(0, Math.round((parent.kwh - downstreamTotalKwh) * 100) / 100);
            const parentCostGross = Math.round(parent.kwh * avgPrice * 100) / 100;
            const parentCostNet = Math.round(parentKwhNet * avgPrice * 100) / 100;

            groupedDevices.push({
                ...parent,
                kwh_gross: parent.kwh,
                kwh_net: parentKwhNet,
                cost_gross: parentCostGross,
                cost_net: parentCostNet,
                cost_eur: parentCostNet,  // primary cost = net
                pct: refTotalKwh > 0 ? Math.round((parent.kwh / refTotalKwh) * 1000) / 10 : 0,
                phases,
                downstream,
            });
        }

        // Note: orphan downstream devices whose parent is outside this factory
        // are already included as standalone in parentDeviceList

        // Sort by kwh descending
        groupedDevices.sort((a, b) => b.kwh - a.kwh);

        // Sum of all sub-meters (exclude general meter, exclude downstream/phase children)
        const sumSubMetersKwh = allDevices
            .filter(d => !d.is_general_meter && !downstreamDeviceIds.has(d.device_id) && !phaseDeviceIds.has(d.device_id))
            .reduce((s, d) => s + d.kwh, 0);
        const unmonitoredKwh = Math.max(0, Math.round((refTotalKwh - sumSubMetersKwh) * 100) / 100);

        return {
            devices: groupedDevices,
            unmonitored: {
                kwh: unmonitoredKwh,
                kw: refTotalKwh > 0 ? Math.round((unmonitoredKwh / rangeHours) * 100) / 100 : 0,
                cost_eur: Math.round(unmonitoredKwh * avgPrice * 100) / 100,
                pct: refTotalKwh > 0 ? Math.round((unmonitoredKwh / refTotalKwh) * 1000) / 10 : 0,
            },
            total: {
                kwh: Math.round(refTotalKwh * 100) / 100,
                kw: generalMeterKw,
                cost_eur: Math.round(refTotalCost * 100) / 100,
                avg_price_kwh: Math.round(avgPrice * 10000) / 10000,
            },
        };
    } catch (err) {
        console.error('[Report] getDeviceBreakdown error:', err.message);
        return { devices: [], unmonitored: { kwh: 0, kw: 0, cost_eur: 0, pct: 0 }, total: {} };
    }
};

/**
 * Professional Power Quality analysis (Circular 3/2020 CNMC)
 * Returns:
 *  - reactive_by_period: kWh, kVArh, ratio, excess kVArh, penalty € per tariff period
 *  - maximeter: 15-min max demand vs contracted power per period  
 *  - pf_timeline: hourly PF chart data
 *  - kpis: global summary
 */
const getPowerQuality = async (factoryId, from, to) => {
    try {
        const tz = await getFactoryTimezone(factoryId);
        const { resolvePeriod } = require('../utils/period-resolver');

        // 1. Get general meter
        const gmResult = await db.query(
            `SELECT id FROM devices WHERE factory_id = $1 AND device_role = 'general_meter' AND is_active = true LIMIT 1`,
            [factoryId]
        );
        if (!gmResult.rows.length) {
            return { pf_timeline: [], reactive_by_period: {}, maximeter: {}, kpis: { avg_pf: 0, status: 'no_meter' } };
        }
        const gmId = gmResult.rows[0].id;

        // 2. Get contract info (power per period, tariff type, reactive threshold)
        const contractResult = await db.query(
            `SELECT c.*, f.timezone FROM contracts c
             JOIN factories f ON f.id = c.factory_id
             WHERE c.factory_id = $1 AND c.is_active = true
             ORDER BY c.start_date DESC LIMIT 1`,
            [factoryId]
        );
        const contract = contractResult.rows[0] || {};
        const tariffType = contract.tariff_type || '6.1TD';
        const reactiveThreshold = parseFloat(contract.reactive_penalty_threshold || 33) / 100; // 0.33
        const REACTIVE_PRICE_PER_KVARH = 0.041554; // €/kVArh (2024 tariff)

        const contractedPower = {
            P1: parseFloat(contract.power_p1_kw) || 0,
            P2: parseFloat(contract.power_p2_kw) || 0,
            P3: parseFloat(contract.power_p3_kw) || 0,
            P4: parseFloat(contract.power_p4_kw) || 0,
            P5: parseFloat(contract.power_p5_kw) || 0,
            P6: parseFloat(contract.power_p6_kw) || 0,
        };

        // 3. Get raw telemetry: 5-min samples with W, VAr, PF, timestamp
        const telemetryResult = await db.query(`
            SELECT
                time,
                power_w_total,
                COALESCE(power_var_l1, 0) + COALESCE(power_var_l2, 0) + COALESCE(power_var_l3, 0) AS var_total,
                power_factor
            FROM telemetry
            WHERE device_id = $1
              AND time >= $2::timestamptz
              AND time < $3::timestamptz
              AND power_w_total > 0
            ORDER BY time
        `, [gmId, from, to]);

        const SAMPLE_INTERVAL_H = 5 / 60; // 5 minutes in hours

        // 4. Classify each sample by tariff period and accumulate
        const periodAccum = {}; // { P1: { wh_sum, varh_sum, pf_sum, pf_count, ... } }
        const maxDemand15min = {}; // { P1: { buckets: { bucketKey: [w1, w2, w3] } } }

        // Initialize periods
        for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
            periodAccum[p] = { wh_sum: 0, varh_sum: 0, pf_sum: 0, pf_count: 0, samples: 0 };
            maxDemand15min[p] = { max_kw: 0, max_time: null };
        }

        // Track 15-min buckets for maxímetro
        const fifteenMinBuckets = {}; // { "P1|2026-03-12T10:00": { w_sum, count } }

        for (const row of telemetryResult.rows) {
            const ts = new Date(row.time);
            // Convert to factory timezone for period classification
            const localStr = ts.toLocaleString('en-US', { timeZone: tz });
            const localDate = new Date(localStr);
            
            const period = await resolvePeriod(localDate, tariffType);

            const watts = parseFloat(row.power_w_total) || 0;
            const vars = Math.abs(parseFloat(row.var_total) || 0); // absolute value for inductiva
            const pf = parseFloat(row.power_factor) || 0;

            // Accumulate energy: W × hours → Wh, then /1000 → kWh
            periodAccum[period].wh_sum += watts * SAMPLE_INTERVAL_H;
            periodAccum[period].varh_sum += vars * SAMPLE_INTERVAL_H;
            if (pf > 0) {
                periodAccum[period].pf_sum += pf;
                periodAccum[period].pf_count++;
            }
            periodAccum[period].samples++;

            // 15-min bucket for maxímetro
            const bucketMinute = Math.floor(localDate.getMinutes() / 15) * 15;
            const bucketKey = `${period}|${localDate.getFullYear()}-${String(localDate.getMonth()+1).padStart(2,'0')}-${String(localDate.getDate()).padStart(2,'0')}T${String(localDate.getHours()).padStart(2,'0')}:${String(bucketMinute).padStart(2,'0')}`;
            
            if (!fifteenMinBuckets[bucketKey]) {
                fifteenMinBuckets[bucketKey] = { period, w_sum: 0, count: 0, time: ts.toISOString() };
            }
            fifteenMinBuckets[bucketKey].w_sum += watts;
            fifteenMinBuckets[bucketKey].count++;
        }

        // Calculate max demand (kW) per 15-min bucket per period
        for (const [, bucket] of Object.entries(fifteenMinBuckets)) {
            const avgKw = (bucket.w_sum / bucket.count) / 1000; // average W in bucket → kW
            if (avgKw > maxDemand15min[bucket.period].max_kw) {
                maxDemand15min[bucket.period].max_kw = avgKw;
                maxDemand15min[bucket.period].max_time = bucket.time;
            }
        }

        // 5. Build reactive_by_period result
        const reactive_by_period = {};
        let totalKwh = 0, totalKvarh = 0, totalExcess = 0, totalPenalty = 0;
        let globalPfSum = 0, globalPfCount = 0;

        for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
            const acc = periodAccum[p];
            if (acc.samples === 0) continue;

            const kwh = Math.round(acc.wh_sum / 1000 * 100) / 100;
            const kvarh = Math.round(acc.varh_sum / 1000 * 100) / 100;
            const ratio = kwh > 0 ? Math.round((kvarh / kwh) * 1000) / 10 : 0; // percentage
            const excessKvarh = Math.max(0, Math.round((kvarh - reactiveThreshold * kwh) * 100) / 100);
            const penaltyEur = Math.round(excessKvarh * REACTIVE_PRICE_PER_KVARH * 100) / 100;
            const avgPf = acc.pf_count > 0 ? Math.round((acc.pf_sum / acc.pf_count) * 1000) / 1000 : 0;

            reactive_by_period[p] = {
                kwh, kvarh, ratio, excess_kvarh: excessKvarh,
                penalty_eur: penaltyEur, avg_pf: avgPf, samples: acc.samples,
            };

            totalKwh += kwh;
            totalKvarh += kvarh;
            totalExcess += excessKvarh;
            totalPenalty += penaltyEur;
            globalPfSum += acc.pf_sum;
            globalPfCount += acc.pf_count;
        }

        // 6. Build maximeter result
        const maximeter = {};
        let hasMaximeterPenalty = false;

        for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
            const contracted = contractedPower[p];
            if (contracted <= 0) continue;
            
            const demand = Math.round(maxDemand15min[p].max_kw * 100) / 100;
            const excessPct = demand > contracted ? Math.round(((demand - contracted) / contracted) * 1000) / 10 : 0;

            // Penalty bands per RD 1164/2001
            let penaltyMultiplier = 0;
            if (excessPct > 15) penaltyMultiplier = 3;       // >15% = triple
            else if (excessPct > 5) penaltyMultiplier = 2;   // 5-15% = double
            else if (excessPct > 0) penaltyMultiplier = 0;   // 0-5% = no extra penalty (within tolerance)

            if (penaltyMultiplier > 0) hasMaximeterPenalty = true;

            maximeter[p] = {
                contracted_kw: contracted,
                max_demand_kw: demand,
                max_demand_time: maxDemand15min[p].max_time,
                excess_pct: excessPct,
                penalty_multiplier: penaltyMultiplier,
                status: excessPct > 15 ? 'critical' : excessPct > 5 ? 'warning' : excessPct > 0 ? 'info' : 'ok',
            };
        }

        // 7. PF hourly timeline (keep for chart)
        const hourlyResult = await db.query(`
            SELECT
                time_bucket('1 hour', time, '${tz}') AS hour,
                AVG(power_factor) AS avg_pf,
                MIN(power_factor) AS min_pf,
                MAX(power_factor) AS max_pf
            FROM telemetry
            WHERE device_id = $1
              AND time >= $2::timestamptz AND time < $3::timestamptz
              AND power_factor > 0
            GROUP BY hour ORDER BY hour
        `, [gmId, from, to]);

        const hourlyMap = {};
        let globalMinPf = 1, minPfTimestamp = null, hoursBelowThreshold = 0;
        for (const r of hourlyResult.rows) {
            const key = new Date(r.hour).getTime();
            const avgPf = parseFloat(r.avg_pf) || 0;
            const minPf = parseFloat(r.min_pf) || 0;
            hourlyMap[key] = {
                time: new Date(key).toISOString(),
                avg_pf: Math.round(avgPf * 1000) / 1000,
                min_pf: Math.round(minPf * 1000) / 1000,
                max_pf: Math.round((parseFloat(r.max_pf) || 0) * 1000) / 1000,
            };
            if (avgPf < 0.95) hoursBelowThreshold++;
            if (minPf > 0 && minPf < globalMinPf) {
                globalMinPf = minPf;
                minPfTimestamp = new Date(key).toISOString();
            }
        }

        // Fill gaps in timeline
        const fromDate = new Date(from);
        const toDate = new Date(to);
        const pf_timeline = [];
        const cursor = new Date(fromDate);
        cursor.setMinutes(0, 0, 0);
        while (cursor < toDate) {
            const ts = cursor.getTime();
            pf_timeline.push(hourlyMap[ts] || {
                time: new Date(ts).toISOString(), avg_pf: null, min_pf: null, max_pf: null,
            });
            cursor.setHours(cursor.getHours() + 1);
        }

        // 8. Global KPIs
        const avgPf = globalPfCount > 0 ? Math.round((globalPfSum / globalPfCount) * 1000) / 1000 : 0;
        const globalRatio = totalKwh > 0 ? Math.round((totalKvarh / totalKwh) * 1000) / 10 : 0;

        // 9. Phase balance analysis (V, I, W per L1/L2/L3)
        //    Auto-detect: if voltage_l2_n is NULL/0 → single-phase meter (EM111)
        let phase_balance = null;
        let isThreePhase = true;
        try {
            const phaseResult = await db.query(`
                SELECT
                    AVG(voltage_l1_n) AS avg_v1, AVG(voltage_l2_n) AS avg_v2, AVG(voltage_l3_n) AS avg_v3,
                    AVG(current_l1) AS avg_i1, AVG(current_l2) AS avg_i2, AVG(current_l3) AS avg_i3,
                    AVG(power_w_l1) AS avg_w1, AVG(power_w_l2) AS avg_w2, AVG(power_w_l3) AS avg_w3
                FROM telemetry
                WHERE device_id = $1
                  AND time >= $2::timestamptz AND time < $3::timestamptz
                  AND voltage_l1_n > 0
            `, [gmId, from, to]);

            const pr = phaseResult.rows[0];
            if (pr && parseFloat(pr.avg_v1) > 0) {
                const vl2 = parseFloat(pr.avg_v2) || 0;
                isThreePhase = vl2 > 50; // If L2 voltage > 50V it's three-phase

                if (isThreePhase) {
                    const calcImbalance = (a, b, c) => {
                        const avg = (a + b + c) / 3;
                        if (avg <= 0) return 0;
                        return Math.round(((Math.max(a, b, c) - Math.min(a, b, c)) / avg) * 1000) / 10;
                    };

                    const vl1 = parseFloat(pr.avg_v1) || 0;
                    const vl3 = parseFloat(pr.avg_v3) || 0;
                    const il1 = parseFloat(pr.avg_i1) || 0;
                    const il2 = parseFloat(pr.avg_i2) || 0;
                    const il3 = parseFloat(pr.avg_i3) || 0;
                    const wl1 = parseFloat(pr.avg_w1) || 0;
                    const wl2 = parseFloat(pr.avg_w2) || 0;
                    const wl3 = parseFloat(pr.avg_w3) || 0;

                    const vImb = calcImbalance(vl1, vl2, vl3);
                    const iImb = calcImbalance(il1, il2, il3);
                    const wImb = calcImbalance(wl1, wl2, wl3);

                    phase_balance = {
                        voltage: {
                            avg_l1: Math.round(vl1 * 10) / 10, avg_l2: Math.round(vl2 * 10) / 10, avg_l3: Math.round(vl3 * 10) / 10,
                            imbalance_pct: vImb,
                            status: vImb > 5 ? 'critical' : vImb > 2 ? 'warning' : 'ok',
                        },
                        current: {
                            avg_l1: Math.round(il1 * 100) / 100, avg_l2: Math.round(il2 * 100) / 100, avg_l3: Math.round(il3 * 100) / 100,
                            imbalance_pct: iImb,
                            status: iImb > 20 ? 'critical' : iImb > 10 ? 'warning' : 'ok',
                        },
                        power: {
                            avg_l1: Math.round(wl1), avg_l2: Math.round(wl2), avg_l3: Math.round(wl3),
                            imbalance_pct: wImb,
                            status: wImb > 20 ? 'critical' : wImb > 10 ? 'warning' : 'ok',
                        },
                    };
                }
                // Single-phase: phase_balance stays null (section hidden in frontend)
            }
        } catch (e) { console.warn('[Report] Phase balance query failed:', e.message); }

        // 10. Voltage monitoring (per-phase min/max, out-of-range hours)
        //     Adapts automatically: single-phase shows only L1
        let voltage_monitoring = null;
        const NOMINAL_V = 230;
        const V_TOLERANCE = 0.07; // ±7% per EN 50160
        const V_MIN = NOMINAL_V * (1 - V_TOLERANCE); // 213.9V
        const V_MAX = NOMINAL_V * (1 + V_TOLERANCE); // 246.1V
        const activePhases = isThreePhase ? ['l1', 'l2', 'l3'] : ['l1'];
        try {
            const voltResult = await db.query(`
                SELECT
                    AVG(voltage_l1_n) AS avg_v1, MIN(voltage_l1_n) AS min_v1, MAX(voltage_l1_n) AS max_v1,
                    AVG(voltage_l2_n) AS avg_v2, MIN(voltage_l2_n) AS min_v2, MAX(voltage_l2_n) AS max_v2,
                    AVG(voltage_l3_n) AS avg_v3, MIN(voltage_l3_n) AS min_v3, MAX(voltage_l3_n) AS max_v3
                FROM telemetry
                WHERE device_id = $1
                  AND time >= $2::timestamptz AND time < $3::timestamptz
                  AND voltage_l1_n > 0
            `, [gmId, from, to]);

            // Count hours out of range — only check active phases
            const oorConditions = activePhases.map(p => {
                const col = `voltage_${p}_n`;
                return `(${col} < $4 OR ${col} > $5)`;
            }).join(' OR ');
            const oorResult = await db.query(`
                SELECT COUNT(DISTINCT time_bucket('1 hour', time, '${tz}')) AS oor_hours
                FROM telemetry
                WHERE device_id = $1
                  AND time >= $2::timestamptz AND time < $3::timestamptz
                  AND (${oorConditions})
            `, [gmId, from, to, V_MIN, V_MAX]);

            const vr = voltResult.rows[0];
            if (vr && parseFloat(vr.avg_v1) > 0) {
                const oorHours = parseInt(oorResult.rows[0]?.oor_hours) || 0;
                const phaseData = {};
                for (const ph of activePhases) {
                    const idx = ph === 'l1' ? '1' : ph === 'l2' ? '2' : '3';
                    phaseData[ph] = {
                        avg: Math.round(parseFloat(vr[`avg_v${idx}`]) * 10) / 10,
                        min: Math.round(parseFloat(vr[`min_v${idx}`]) * 10) / 10,
                        max: Math.round(parseFloat(vr[`max_v${idx}`]) * 10) / 10,
                    };
                }
                voltage_monitoring = {
                    nominal_v: NOMINAL_V,
                    tolerance_pct: V_TOLERANCE * 100,
                    range_min: Math.round(V_MIN * 10) / 10,
                    range_max: Math.round(V_MAX * 10) / 10,
                    phases: activePhases,
                    ...phaseData,
                    hours_out_of_range: oorHours,
                    hours_total: Object.keys(hourlyMap).length,
                    status: oorHours > 0 ? 'warning' : 'ok',
                };
            }
        } catch (e) { console.warn('[Report] Voltage monitoring query failed:', e.message); }

        return {
            pf_timeline,
            reactive_by_period,
            maximeter,
            phase_balance,
            voltage_monitoring,
            kpis: {
                avg_pf: avgPf,
                min_pf: Math.round(globalMinPf * 1000) / 1000,
                min_pf_time: minPfTimestamp,
                hours_total: Object.keys(hourlyMap).length,
                hours_below_095: hoursBelowThreshold,
                total_kwh: Math.round(totalKwh * 100) / 100,
                total_kvarh: Math.round(totalKvarh * 100) / 100,
                global_ratio: globalRatio,
                total_excess_kvarh: Math.round(totalExcess * 100) / 100,
                total_reactive_penalty_eur: Math.round(totalPenalty * 100) / 100,
                has_maximeter_penalty: hasMaximeterPenalty,
                status: avgPf >= 0.95 ? 'excellent' : avgPf >= 0.90 ? 'warning' : 'critical',
            },
        };
    } catch (err) {
        console.error('[Report] getPowerQuality error:', err.message);
        return {
            pf_timeline: [],
            reactive_by_period: {},
            maximeter: {},
            phase_balance: null,
            voltage_monitoring: null,
            kpis: {
                avg_pf: 0, min_pf: 0, min_pf_time: null,
                hours_total: 0, hours_below_095: 0,
                total_kwh: 0, total_kvarh: 0, global_ratio: 0,
                total_excess_kvarh: 0, total_reactive_penalty_eur: 0,
                has_maximeter_penalty: false, status: 'unknown',
            },
        };
    }
};

/**
 * Per-device historical report for a date range.
 * Handles standard devices, downstream devices, and phase (L1/L2/L3) virtual devices.
 * Returns hierarchy context changes over the period.
 */
const getDeviceReport = async (factoryId, deviceId, from, to) => {
    try {
        const tz = await getFactoryTimezone(factoryId);

        // 1. Get device info (including inactive)
        const deviceResult = await db.query(`
            SELECT d.*, pd.name AS parent_name
            FROM devices d
            LEFT JOIN devices pd ON d.parent_device_id = pd.id
            WHERE d.id = $1 AND d.factory_id = $2
        `, [deviceId, factoryId]);

        if (deviceResult.rows.length === 0) {
            return { error: 'Dispositivo no encontrado', device: null, kpis: {}, timeline: [], hierarchy_changes: [] };
        }

        const device = deviceResult.rows[0];
        const isPhaseDevice = device.parent_relation === 'phase_channel' && device.phase_channel;
        const queryDeviceId = isPhaseDevice ? device.parent_device_id : deviceId;

        // 2. Query from telemetry_hourly CAGG (pre-computed, validated deltas)
        let timelineQuery;
        let timelineParams;

        if (isPhaseDevice) {
            // Phase device → query parent's per-phase columns from CAGG
            const ch = device.phase_channel.toLowerCase(); // 'l1', 'l2', 'l3'
            timelineQuery = `
                SELECT
                    bucket AS hour,
                    avg_power_w_${ch} AS avg_power_w,
                    max_power_w_${ch} AS max_power_w,
                    avg_power_factor AS avg_pf,
                    min_power_factor AS min_pf,
                    delta_kwh_${ch} AS delta_kwh,
                    avg_current_${ch} AS avg_current,
                    avg_voltage_${ch} AS avg_voltage,
                    sample_count AS samples
                FROM telemetry_hourly
                WHERE device_id = $1
                  AND bucket >= $2::timestamptz
                  AND bucket < $3::timestamptz
                ORDER BY bucket
            `;
            timelineParams = [queryDeviceId, from, to];
        } else {
            // Standard / downstream device → query from CAGG directly
            timelineQuery = `
                SELECT
                    bucket AS hour,
                    avg_power_w,
                    max_power_w,
                    avg_power_factor AS avg_pf,
                    min_power_factor AS min_pf,
                    delta_kwh,
                    avg_current_l1 AS avg_current,
                    avg_voltage_l1 AS avg_voltage,
                    sample_count AS samples
                FROM telemetry_hourly
                WHERE device_id = $1
                  AND bucket >= $2::timestamptz
                  AND bucket < $3::timestamptz
                ORDER BY bucket
            `;
            timelineParams = [deviceId, from, to];
        }

        const timelineResult = await db.query(timelineQuery, timelineParams);

        // 3. KPIs — use raw telemetry (same as getDeviceBreakdown for consistency)
        const BATCH_INTERVAL_SEC = 300;
        let kpiQuery, kpiParams;

        if (isPhaseDevice) {
            const ch = device.phase_channel.toLowerCase();
            kpiQuery = `
                SELECT
                    COALESCE(AVG(power_w_${ch}), 0) / 1000 AS avg_kw,
                    COALESCE(MAX(power_w_${ch}), 0) AS peak_w,
                    AVG(CASE WHEN power_factor > 0 THEN power_factor ELSE NULL END) AS avg_pf,
                    MIN(CASE WHEN power_factor > 0 THEN power_factor ELSE NULL END) AS min_pf,
                    COUNT(*) AS samples
                FROM telemetry
                WHERE device_id = $1
                  AND time >= $2::timestamptz AND time < $3::timestamptz
            `;
            kpiParams = [queryDeviceId, from, to];
        } else {
            kpiQuery = `
                SELECT
                    COALESCE(AVG(power_w_total), 0) / 1000 AS avg_kw,
                    COALESCE(MAX(power_w_total), 0) AS peak_w,
                    AVG(CASE WHEN power_factor > 0 THEN power_factor ELSE NULL END) AS avg_pf,
                    MIN(CASE WHEN power_factor > 0 THEN power_factor ELSE NULL END) AS min_pf,
                    COUNT(*) AS samples
                FROM telemetry
                WHERE device_id = $1
                  AND time >= $2::timestamptz AND time < $3::timestamptz
            `;
            kpiParams = [deviceId, from, to];
        }

        const kpiResult = await db.query(kpiQuery, kpiParams);
        const kpiRow = kpiResult.rows[0] || {};
        const avgKw = parseFloat(kpiRow.avg_kw) || 0;
        const peakW = parseFloat(kpiRow.peak_w) || 0;
        const kpiSamples = parseInt(kpiRow.samples) || 0;
        const actualHours = kpiSamples > 0 ? (kpiSamples * BATCH_INTERVAL_SEC) / 3600 : 0;
        const totalKwh = Math.round(avgKw * actualHours * 100) / 100;
        const avgPf = parseFloat(kpiRow.avg_pf) || 0;
        const minPf = parseFloat(kpiRow.min_pf) || 1;

        // Peak time — fast ORDER BY instead of float equality
        let peakKwTime = null;
        if (peakW > 0) {
            const peakCol = isPhaseDevice ? `power_w_${device.phase_channel.toLowerCase()}` : 'power_w_total';
            try {
                const peakResult = await db.query(`
                    SELECT time FROM telemetry
                    WHERE device_id = $1
                      AND time >= $2::timestamptz AND time < $3::timestamptz
                    ORDER BY ${peakCol} DESC LIMIT 1
                `, [isPhaseDevice ? queryDeviceId : deviceId, from, to]);
                if (peakResult.rows.length) peakKwTime = peakResult.rows[0].time;
            } catch (e) { /* ignore */ }
        }

        // Hours below PF 0.95 — count from CAGG timeline (Circular 3/2020 CNMC)
        let hoursBelowPf095 = 0;
        for (const r of timelineResult.rows) {
            const pf = parseFloat(isPhaseDevice ? r.avg_pf : r.avg_pf);
            if (pf && pf > 0 && pf < 0.95) hoursBelowPf095++;
        }

        // 4. Build timeline array for chart (from CAGG, includes gaps)
        const fromDate = new Date(from);
        const toDate = new Date(to);
        const timeline = [];
        const cursor = new Date(fromDate);
        cursor.setMinutes(0, 0, 0);

        const dataMap = {};
        for (const r of timelineResult.rows) {
            dataMap[new Date(r.hour).getTime()] = r;
        }

        while (cursor < toDate) {
            const ts = cursor.getTime();
            const row = dataMap[ts];

            if (row) {
                const pw = parseFloat(row.avg_power_w) || 0;
                const maxPw = parseFloat(row.max_power_w) || 0;
                const pf = parseFloat(row.avg_pf) || null;
                const samples = parseInt(row.samples) || 0;
                const hourKwh = Math.round((pw / 1000) * (samples * BATCH_INTERVAL_SEC / 3600) * 100) / 100;

                timeline.push({
                    time: new Date(ts).toISOString(),
                    avg_kw: Math.round((pw / 1000) * 100) / 100,
                    max_kw: Math.round(maxPw / 10) / 100,
                    avg_pf: pf && pf > 0 ? Math.round(pf * 1000) / 1000 : null,
                    delta_kwh: hourKwh,
                    avg_current: parseFloat(row.avg_current) || null,
                    avg_voltage: parseFloat(row.avg_voltage) || null,
                });
            } else {
                timeline.push({
                    time: new Date(ts).toISOString(),
                    avg_kw: null, max_kw: null, avg_pf: null,
                    delta_kwh: null, avg_current: null, avg_voltage: null,
                });
            }

            cursor.setHours(cursor.getHours() + 1);
        }

        // 5. Estimate cost — use same real avg price as getDeviceBreakdown
        let estimatedCost = 0;
        try {
            const fromDate2 = new Date(from);
            const toDate2 = new Date(to);
            const isSingleDay = (toDate2 - fromDate2) < 86400000 * 1.5;
            let avgPricePerKwh = 0;

            if (isSingleDay) {
                try {
                    const dateStr = from.split('T')[0];
                    const dailyData = await costService.getDailyCostBreakdown(factoryId, dateStr);
                    const dailyKwh = dailyData.total_kwh || 0;
                    avgPricePerKwh = dailyKwh > 0 ? (dailyData.total_cost || 0) / dailyKwh : 0;
                } catch (e) { /* fallback below */ }
            }

            if (!avgPricePerKwh) {
                try {
                    const costResult = await db.query(`
                        SELECT CASE WHEN SUM(kwh_consumed) > 0
                            THEN SUM(cost_eur) / SUM(kwh_consumed) ELSE 0
                        END AS avg_price
                        FROM cost_snapshots
                        WHERE factory_id = $1
                          AND timestamp >= $2::timestamptz AND timestamp < $3::timestamptz
                    `, [factoryId, from, to]);
                    avgPricePerKwh = parseFloat(costResult.rows[0]?.avg_price) || 0;
                } catch (e) { /* fallback below */ }
            }

            // Final fallback: contract default
            if (!avgPricePerKwh) {
                const contract = await costService.getActiveContract(factoryId);
                avgPricePerKwh = parseFloat(contract?.price_kwh_default) || 0.15;
            }

            estimatedCost = Math.round(totalKwh * avgPricePerKwh * 100) / 100;
        } catch (e) { /* no cost data */ }

        // 5. Hierarchy context changes from device_hierarchy_log
        let hierarchyChanges = [];
        if (!isPhaseDevice) {
            try {
                const hierResult = await db.query(`
                    SELECT
                        dhl.action,
                        dhl.parent_device_id,
                        dhl.parent_relation,
                        dhl.timestamp,
                        pd.name AS parent_name
                    FROM device_hierarchy_log dhl
                    LEFT JOIN devices pd ON pd.id = dhl.parent_device_id
                    WHERE dhl.device_id = $1
                      AND dhl.timestamp >= $2::timestamptz
                      AND dhl.timestamp < $3::timestamptz
                    ORDER BY dhl.timestamp
                `, [deviceId, from, to]);

                for (const row of hierResult.rows) {
                    hierarchyChanges.push({
                        from: new Date(row.timestamp).toISOString(),
                        action: row.action,
                        parent_device_id: row.parent_device_id || null,
                        parent_relation: row.parent_relation || null,
                        parent_name: row.parent_name || null,
                        label: row.action === 'attached'
                            ? `${row.parent_relation === 'downstream' ? 'Downstream' : 'Hijo'} de ${row.parent_name || 'dispositivo desconocido'}`
                            : 'Independiente (desconectado)',
                    });
                }

                // If no changes in range, show the state AT the start of the range
                if (!hierarchyChanges.length) {
                    const initState = await db.query(`
                        SELECT DISTINCT ON (device_id) dhl.parent_device_id, dhl.parent_relation, dhl.action, pd.name AS parent_name
                        FROM device_hierarchy_log dhl
                        LEFT JOIN devices pd ON pd.id = dhl.parent_device_id
                        WHERE dhl.device_id = $1 AND dhl.timestamp <= $2
                        ORDER BY dhl.device_id, dhl.timestamp DESC
                    `, [deviceId, from]);

                    if (initState.rows.length && initState.rows[0].action === 'attached') {
                        const s = initState.rows[0];
                        hierarchyChanges.push({
                            from: from,
                            action: 'attached',
                            parent_device_id: s.parent_device_id,
                            parent_relation: s.parent_relation,
                            parent_name: s.parent_name || null,
                            label: `${s.parent_relation === 'downstream' ? 'Downstream' : 'Hijo'} de ${s.parent_name || 'dispositivo desconocido'}`,
                        });
                    } else {
                        hierarchyChanges.push({
                            from: from,
                            action: null,
                            parent_device_id: null,
                            parent_relation: null,
                            parent_name: null,
                            label: 'Independiente',
                        });
                    }
                }
            } catch (e) {
                console.warn('[Report] Hierarchy context failed:', e.message);
            }
        } else {
            // Phase device — get historical context from device_hierarchy_log
            const phaseHist = await db.query(`
                SELECT DISTINCT ON (device_id) dhl.parent_device_id, dhl.parent_relation, dhl.phase_channel, pd.name AS parent_name
                FROM device_hierarchy_log dhl
                LEFT JOIN devices pd ON pd.id = dhl.parent_device_id
                WHERE dhl.device_id = $1 AND dhl.timestamp <= $2 AND dhl.action = 'attached'
                ORDER BY dhl.device_id, dhl.timestamp DESC
            `, [deviceId, to]);

            const ph = phaseHist.rows[0];
            hierarchyChanges = [{
                from: from,
                parent_device_id: ph?.parent_device_id || device.parent_device_id,
                parent_relation: 'phase_channel',
                parent_name: ph?.parent_name || device.parent_name,
                label: `Fase ${ph?.phase_channel || device.phase_channel} de ${ph?.parent_name || device.parent_name || 'dispositivo desconocido'}`,
            }];
        }

        // 6. Load factor, operating hours, cost by period
        const peakKw = Math.round(peakW / 10) / 100; // same formula as kpis.peak_kw
        const loadFactor = peakKw > 0 ? Math.round((avgKw / peakKw) * 1000) / 10 : 0;

        // Operating vs idle hours — from timeline data
        // A machine is "operating" if avg_kw >= 0.1 kW (100W threshold to filter noise/standby)
        const OPERATING_THRESHOLD_KW = 0.1;
        let operatingHours = 0;
        let idleHours = 0;
        for (const entry of timeline) {
            if (entry.avg_kw !== null) {
                if (entry.avg_kw >= OPERATING_THRESHOLD_KW) {
                    operatingHours++;
                } else {
                    idleHours++;
                }
            }
        }

        // Cost by tariff period — distribute device kWh across periods using factory cost_snapshots
        let costByPeriod = null;
        try {
            const { resolvePeriod } = require('../utils/period-resolver');
            const contractResult2 = await db.query(
                `SELECT tariff_type FROM contracts WHERE factory_id = $1 AND is_active = true ORDER BY start_date DESC LIMIT 1`,
                [factoryId]
            );
            const tariffType = contractResult2.rows[0]?.tariff_type || '6.1TD';

            // Use the device's hourly timeline to classify each hour into a period
            // Then apply the factory's avg price per period from cost_snapshots
            const periodKwh = {}; // { P1: total_kwh, P2: total_kwh, ... }

            for (const entry of timeline) {
                if (entry.delta_kwh && entry.delta_kwh > 0) {
                    const ts = new Date(entry.time);
                    const localStr = ts.toLocaleString('en-US', { timeZone: tz });
                    const localDate = new Date(localStr);
                    const period = await resolvePeriod(localDate, tariffType);
                    if (!periodKwh[period]) periodKwh[period] = 0;
                    periodKwh[period] += entry.delta_kwh;
                }
            }

            // Get avg price per period from cost_snapshots (factory level)
            const priceResult = await db.query(`
                SELECT period,
                    CASE WHEN SUM(kwh_consumed) > 0
                        THEN SUM(cost_eur) / SUM(kwh_consumed) ELSE 0
                    END AS avg_price
                FROM cost_snapshots
                WHERE factory_id = $1
                  AND timestamp >= $2::timestamptz AND timestamp < $3::timestamptz
                GROUP BY period
            `, [factoryId, from, to]);

            const periodPrices = {};
            for (const r of priceResult.rows) {
                periodPrices[r.period] = parseFloat(r.avg_price) || 0;
            }

            // Fallback: if no cost_snapshots, use live calculation for single-day
            if (Object.keys(periodPrices).length === 0) {
                try {
                    const dateStr = from.split('T')[0];
                    const dailyData = await costService.getDailyCostBreakdown(factoryId, dateStr);
                    if (dailyData.hours) {
                        for (const h of dailyData.hours) {
                            if (h.kwh > 0 && !periodPrices[h.period]) {
                                periodPrices[h.period] = h.cost / h.kwh;
                            }
                        }
                    }
                } catch (e) { /* fallback to default */ }
            }

            // Build cost by period result
            const cbp = {};
            let totalPeriodCost = 0;
            for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
                const kwh = Math.round((periodKwh[p] || 0) * 100) / 100;
                if (kwh <= 0) continue;
                const price = periodPrices[p] || Object.values(periodPrices)[0] || 0.15;
                const cost = Math.round(kwh * price * 100) / 100;
                totalPeriodCost += cost;
                cbp[p] = { kwh, price_kwh: Math.round(price * 10000) / 10000, cost_eur: cost };
            }
            if (Object.keys(cbp).length > 0) {
                costByPeriod = { periods: cbp, total_cost_eur: Math.round(totalPeriodCost * 100) / 100 };
            }
        } catch (e) { console.warn('[Report] Device cost-by-period failed:', e.message); }

        return {
            device: {
                id: device.id,
                name: device.name,
                device_type: device.device_type,
                device_role: device.device_role,
                is_active: device.is_active,
                phase_channel: device.phase_channel,
                parent_device_id: device.parent_device_id,
                parent_name: device.parent_name,
                parent_relation: device.parent_relation,
            },
            kpis: {
                total_kwh: totalKwh,
                avg_kw: Math.round(avgKw * 100) / 100,
                peak_kw: peakKw,
                peak_kw_time: peakKwTime,
                avg_pf: Math.round(avgPf * 1000) / 1000,
                min_pf: Math.round(minPf * 1000) / 1000,
                min_pf_time: null,
                hours_below_095: hoursBelowPf095,
                hours_total: Math.round(actualHours * 10) / 10,
                estimated_cost_eur: estimatedCost,
                load_factor: loadFactor,
                operating_hours: operatingHours,
                idle_hours: idleHours,
            },
            cost_by_period: costByPeriod,
            timeline,
            hierarchy_changes: hierarchyChanges,
        };
    } catch (err) {
        console.error('[Report] getDeviceReport error:', err.message);
        return {
            error: 'Error generando informe del dispositivo',
            device: null,
            kpis: {},
            timeline: [],
            hierarchy_changes: [],
        };
    }
};

module.exports = {
    getSummary,
    getCostByPeriod,
    getPowerDemand,
    getDeviceBreakdown,
    getPowerQuality,
    getDeviceReport,
};
