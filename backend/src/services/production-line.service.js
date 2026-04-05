/**
 * FPSaver — Production Line Service
 * Handles CRUD, membership management, and energy analytics
 * for production lines with temporal membership tracking.
 */

const db = require('../config/database');
const { getFactoryTimezone } = require('../utils/timezone');

// ════════════════════════════════════════════
// CRUD
// ════════════════════════════════════════════

const listLines = async (factoryId) => {
    const result = await db.query(`
        SELECT pl.*,
            (SELECT COUNT(*) FROM production_line_devices pld WHERE pld.production_line_id = pl.id) AS device_count
        FROM production_lines pl
        WHERE pl.factory_id = $1 AND pl.is_active = true
        ORDER BY pl.name
    `, [factoryId]);
    return result.rows;
};

const getLine = async (factoryId, lineId) => {
    const lineResult = await db.query(
        'SELECT * FROM production_lines WHERE id = $1 AND factory_id = $2 AND is_active = true',
        [lineId, factoryId]
    );
    if (!lineResult.rows.length) return null;

    const devicesResult = await db.query(`
        SELECT pld.*, d.name AS device_name, d.device_type, d.model, d.host,
               d.parent_device_id, d.parent_relation, d.phase_channel
        FROM production_line_devices pld
        JOIN devices d ON d.id = pld.device_id
        WHERE pld.production_line_id = $1
        ORDER BY d.name
    `, [lineId]);

    return {
        ...lineResult.rows[0],
        devices: devicesResult.rows,
    };
};

const createLine = async (factoryId, { name, description, color }) => {
    const result = await db.query(
        `INSERT INTO production_lines (factory_id, name, description, color)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [factoryId, name, description || null, color || '#8b5cf6']
    );
    return result.rows[0];
};

const updateLine = async (factoryId, lineId, updates) => {
    // Build SET clause dynamically to allow clearing fields (e.g. description = null)
    const fields = [];
    const values = [];
    let idx = 1;

    if ('name' in updates && updates.name != null) { fields.push(`name = $${idx++}`); values.push(updates.name); }
    if ('description' in updates) { fields.push(`description = $${idx++}`); values.push(updates.description || null); }
    if ('color' in updates && updates.color != null) { fields.push(`color = $${idx++}`); values.push(updates.color); }
    if ('is_active' in updates) { fields.push(`is_active = $${idx++}`); values.push(updates.is_active); }

    if (!fields.length) return null;

    values.push(lineId, factoryId);
    const result = await db.query(
        `UPDATE production_lines SET ${fields.join(', ')} WHERE id = $${idx++} AND factory_id = $${idx} AND is_active = true RETURNING *`,
        values
    );
    return result.rows[0] || null;
};

const deleteLine = async (factoryId, lineId) => {
    const result = await db.query(
        `UPDATE production_lines SET is_active = false WHERE id = $1 AND factory_id = $2 RETURNING id`,
        [lineId, factoryId]
    );
    return result.rows.length > 0;
};

// ════════════════════════════════════════════
// MEMBERSHIP
// ════════════════════════════════════════════

const addDevices = async (lineId, deviceIds) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const added = [];
        for (const deviceId of deviceIds) {
            // Insert into current membership (ignore if already exists)
            const res = await client.query(
                `INSERT INTO production_line_devices (production_line_id, device_id)
                 VALUES ($1, $2)
                 ON CONFLICT (production_line_id, device_id) DO NOTHING
                 RETURNING *`,
                [lineId, deviceId]
            );
            if (res.rows.length) {
                added.push(res.rows[0]);
                // Log to membership history
                await client.query(
                    `INSERT INTO production_line_membership_log (production_line_id, device_id, action)
                     VALUES ($1, $2, 'added')`,
                    [lineId, deviceId]
                );
            }
        }
        await client.query('COMMIT');
        return added;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const removeDevice = async (lineId, deviceId) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const res = await client.query(
            'DELETE FROM production_line_devices WHERE production_line_id = $1 AND device_id = $2 RETURNING *',
            [lineId, deviceId]
        );
        if (res.rows.length) {
            await client.query(
                `INSERT INTO production_line_membership_log (production_line_id, device_id, action)
                 VALUES ($1, $2, 'removed')`,
                [lineId, deviceId]
            );
        }
        await client.query('COMMIT');
        return res.rows.length > 0;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const getMembershipLog = async (lineId) => {
    const result = await db.query(`
        SELECT plml.*, d.name AS device_name
        FROM production_line_membership_log plml
        JOIN devices d ON d.id = plml.device_id
        WHERE plml.production_line_id = $1
        ORDER BY plml.timestamp DESC
    `, [lineId]);
    return result.rows;
};

// ════════════════════════════════════════════
// ANALYTICS — Temporal membership reconstruction
// ════════════════════════════════════════════

/**
 * Get device IDs that were members of a line during a time range.
 * Returns a SQL-compatible array for use in subqueries.
 * 
 * Logic: for each hour bucket in [from, to], find which devices
 * were members at that point by replaying the membership log.
 * 
 * Simplified approach: get all devices that were ever members during
 * the range, then let the analytics queries handle temporal filtering.
 */
const getMembersAtTime = async (lineId, from, to) => {
    // 1. Try temporal reconstruction: last action per device at or before 'to'
    const result = await db.query(`
        SELECT DISTINCT ON (device_id) device_id, action
        FROM production_line_membership_log
        WHERE production_line_id = $1
          AND timestamp <= $2
        ORDER BY device_id, timestamp DESC
    `, [lineId, to]);

    const temporalIds = result.rows
        .filter(r => r.action === 'added')
        .map(r => r.device_id);

    if (temporalIds.length > 0) return temporalIds;

    // 2. Fallback: if no temporal data covers this range (e.g. line just created),
    //    use current members so the user can immediately see historical telemetry
    const fallback = await db.query(
        'SELECT device_id FROM production_line_devices WHERE production_line_id = $1',
        [lineId]
    );
    return fallback.rows.map(r => r.device_id);
};



/**
 * Summary analytics: total kWh, cost, avg/peak power for a date range
 */
const getSummary = async (factoryId, lineId, from, to) => {
    const deviceIds = await getMembersAtTime(lineId, from, to);
    if (!deviceIds.length) {
        return { total_kwh: 0, total_cost: 0, avg_kw: 0, peak_kw: 0, device_count: deviceIds.length };
    }

    // Get average price for the period
    let avgPrice = 0.20;
    try {
        const costResult = await db.query(`
            SELECT CASE WHEN SUM(kwh_consumed) > 0
                THEN SUM(cost_eur) / SUM(kwh_consumed) ELSE 0.20 END AS avg_price
            FROM cost_snapshots
            WHERE factory_id = $1
              AND timestamp >= $2::timestamptz AND timestamp < $3::timestamptz
        `, [factoryId, from, to]);
        avgPrice = parseFloat(costResult.rows[0]?.avg_price) || 0.20;
    } catch (e) { /* use default */ }

    // Query telemetry for these devices
    const BATCH_INTERVAL_SEC = 300;
    const result = await db.query(`
        SELECT
            COALESCE(AVG(power_w_total), 0) / 1000 AS avg_kw,
            COALESCE(MAX(power_w_total), 0) / 1000 AS peak_kw,
            COUNT(*) AS samples
        FROM telemetry
        WHERE device_id = ANY($1)
          AND time >= $2::timestamptz AND time < $3::timestamptz
    `, [deviceIds, from, to]);

    const row = result.rows[0];
    const avgKw = parseFloat(row.avg_kw) || 0;
    const peakKw = parseFloat(row.peak_kw) || 0;
    const samples = parseInt(row.samples) || 0;
    const actualHours = (samples * BATCH_INTERVAL_SEC) / 3600;
    const totalKwh = Math.round(avgKw * actualHours * 100) / 100;
    const totalCost = Math.round(totalKwh * avgPrice * 100) / 100;

    return {
        total_kwh: totalKwh,
        total_cost: totalCost,
        avg_kw: Math.round(avgKw * 100) / 100,
        peak_kw: Math.round(peakKw * 100) / 100,
        avg_price_kwh: Math.round(avgPrice * 10000) / 10000,
        device_count: deviceIds.length,
    };
};

/**
 * Timeline analytics: hourly or daily cost/kWh breakdown
 */
const getTimeline = async (factoryId, lineId, from, to, groupBy = 'hour') => {
    const deviceIds = await getMembersAtTime(lineId, from, to);
    if (!deviceIds.length) return { data: [] };

    const tz = await getFactoryTimezone(factoryId);
    const bucket = groupBy === 'day' ? '1 day' : '1 hour';

    // Get avg price
    let avgPrice = 0.20;
    try {
        const costResult = await db.query(`
            SELECT CASE WHEN SUM(kwh_consumed) > 0
                THEN SUM(cost_eur) / SUM(kwh_consumed) ELSE 0.20 END AS avg_price
            FROM cost_snapshots
            WHERE factory_id = $1
              AND timestamp >= $2::timestamptz AND timestamp < $3::timestamptz
        `, [factoryId, from, to]);
        avgPrice = parseFloat(costResult.rows[0]?.avg_price) || 0.20;
    } catch (e) { /* default */ }

    const BATCH_INTERVAL_SEC = 300;

    const result = await db.query(`
        SELECT
            time_bucket('${bucket}', time, '${tz}') AS bucket,
            COALESCE(AVG(power_w_total), 0) / 1000 AS avg_kw,
            COALESCE(MAX(power_w_total), 0) / 1000 AS max_kw,
            COUNT(*) AS samples
        FROM telemetry
        WHERE device_id = ANY($1)
          AND time >= $2::timestamptz AND time < $3::timestamptz
        GROUP BY bucket
        ORDER BY bucket
    `, [deviceIds, from, to]);

    const data = result.rows.map(r => {
        const avgKw = parseFloat(r.avg_kw) || 0;
        const samples = parseInt(r.samples) || 0;
        const bucketHours = groupBy === 'day' ? 24 : 1;
        const actualHours = Math.min((samples * BATCH_INTERVAL_SEC) / 3600, bucketHours);
        const kwh = Math.round(avgKw * actualHours * 100) / 100;
        return {
            bucket: r.bucket,
            avg_kw: Math.round(avgKw * 100) / 100,
            max_kw: Math.round(parseFloat(r.max_kw) * 100) / 100,
            kwh,
            cost_eur: Math.round(kwh * avgPrice * 100) / 100,
        };
    });

    return { data, avg_price_kwh: avgPrice };
};

/**
 * Per-device breakdown with hierarchy-aware "net" consumption.
 *
 * For each device in the line:
 *   gross = raw meter reading (power_w_total)
 *   net   = gross − sum of children's gross (only children NOT in the line)
 *
 * If both parent and child are in the line, parent's net is NOT reduced
 * (because the child's consumption is accounted for separately).
 *
 * Total line kWh = sum of net values → no double-counting.
 */
const getDeviceBreakdown = async (factoryId, lineId, from, to) => {
    const deviceIds = await getMembersAtTime(lineId, from, to);
    if (!deviceIds.length) return { devices: [], total: { kwh: 0, cost_eur: 0 } };

    // 1. Get avg price
    let avgPrice = 0.20;
    try {
        const costResult = await db.query(`
            SELECT CASE WHEN SUM(kwh_consumed) > 0
                THEN SUM(cost_eur) / SUM(kwh_consumed) ELSE 0.20 END AS avg_price
            FROM cost_snapshots
            WHERE factory_id = $1
              AND timestamp >= $2::timestamptz AND timestamp < $3::timestamptz
        `, [factoryId, from, to]);
        avgPrice = parseFloat(costResult.rows[0]?.avg_price) || 0.20;
    } catch (e) { /* default */ }

    const BATCH_INTERVAL_SEC = 300;
    const lineDeviceIdSet = new Set(deviceIds);

    // 2. Get historical hierarchy at 'to' time using device_hierarchy_log
    //    For each device, find its last hierarchy event at or before 'to'
    const hierarchyResult = await db.query(`
        SELECT DISTINCT ON (device_id) device_id, parent_device_id, parent_relation, phase_channel, action
        FROM device_hierarchy_log
        WHERE timestamp <= $1
        ORDER BY device_id, timestamp DESC
    `, [to]);

    // Build maps: deviceId → {parent_device_id, parent_relation, phase_channel} at 'to' time
    const hierarchyAtTime = {};
    const childrenByParentAtTime = {};
    for (const row of hierarchyResult.rows) {
        if (row.action === 'attached') {
            hierarchyAtTime[row.device_id] = {
                parent_device_id: row.parent_device_id,
                parent_relation: row.parent_relation,
                phase_channel: row.phase_channel,
            };
            if (!childrenByParentAtTime[row.parent_device_id]) childrenByParentAtTime[row.parent_device_id] = [];
            childrenByParentAtTime[row.parent_device_id].push({
                id: row.device_id,
                parent_device_id: row.parent_device_id,
                parent_relation: row.parent_relation,
                phase_channel: row.phase_channel,
            });
        }
        // 'detached' → no entry = not a child at this time
    }

    // 3. Query gross telemetry per device (line members)
    const telResult = await db.query(`
        SELECT
            d.id AS device_id,
            d.name AS device_name,
            d.device_type,
            d.model,
            COALESCE(AVG(t.power_w_total), 0) / 1000 AS avg_kw,
            COALESCE(MAX(t.power_w_total), 0) / 1000 AS peak_kw,
            COUNT(t.*) AS samples
        FROM devices d
        LEFT JOIN telemetry t ON t.device_id = d.id
            AND t.time >= $2::timestamptz AND t.time < $3::timestamptz
        WHERE d.id = ANY($1)
        GROUP BY d.id, d.name, d.device_type, d.model
        ORDER BY avg_kw DESC
    `, [deviceIds, from, to]);

    // 4. Find children of line devices that are NOT in the line (at 'to' time)
    //    → we need to subtract their telemetry from the parent
    const childrenNotInLine = [];
    for (const parentId of deviceIds) {
        const children = childrenByParentAtTime[parentId] || [];
        for (const c of children) {
            if (!lineDeviceIdSet.has(c.id)) {
                childrenNotInLine.push(c.id);
            }
        }
    }

    // Query telemetry for children NOT in line (to subtract from parents)
    const childTelByParent = {}; // parentId → sum of children's kWh
    if (childrenNotInLine.length) {
        const childTel = await db.query(`
            SELECT
                d.id AS device_id,
                COALESCE(AVG(t.power_w_total), 0) / 1000 AS avg_kw,
                COUNT(t.*) AS samples
            FROM devices d
            LEFT JOIN telemetry t ON t.device_id = d.id
                AND t.time >= $2::timestamptz AND t.time < $3::timestamptz
            WHERE d.id = ANY($1)
            GROUP BY d.id
        `, [childrenNotInLine, from, to]);

        for (const r of childTel.rows) {
            const avgKw = parseFloat(r.avg_kw) || 0;
            const samples = parseInt(r.samples) || 0;
            const hours = (samples * BATCH_INTERVAL_SEC) / 3600;
            // Find which parent this child belonged to at 'to' time
            const parentId = hierarchyAtTime[r.device_id]?.parent_device_id;
            if (parentId) {
                childTelByParent[parentId] = (childTelByParent[parentId] || 0)
                    + Math.round(avgKw * hours * 100) / 100;
            }
        }
    }

    // 6. Build result with gross/net
    let totalNetKwh = 0;
    const devices = telResult.rows.map(r => {
        const avgKw = parseFloat(r.avg_kw) || 0;
        const samples = parseInt(r.samples) || 0;
        const actualHours = (samples * BATCH_INTERVAL_SEC) / 3600;
        const kwhGross = Math.round(avgKw * actualHours * 100) / 100;

        // Subtract children NOT in line
        const childKwh = childTelByParent[r.device_id] || 0;
        const kwhNet = Math.max(0, Math.round((kwhGross - childKwh) * 100) / 100);

        // Determine if parent is in the line (for hierarchy display) — use HISTORICAL hierarchy
        const hist = hierarchyAtTime[r.device_id];
        const parentInLine = hist?.parent_device_id ? lineDeviceIdSet.has(hist.parent_device_id) : false;
        const childrenInLine = (childrenByParentAtTime[r.device_id] || [])
            .filter(c => lineDeviceIdSet.has(c.id))
            .map(c => c.id);

        totalNetKwh += kwhNet;

        return {
            device_id: r.device_id,
            device_name: r.device_name,
            device_type: r.device_type,
            model: r.model,
            parent_device_id: hist?.parent_device_id || null,
            parent_relation: hist?.parent_relation || null,
            phase_channel: hist?.phase_channel || null,
            parent_in_line: parentInLine,
            children_in_line: childrenInLine,
            avg_kw: Math.round(avgKw * 100) / 100,
            peak_kw: Math.round(parseFloat(r.peak_kw) * 100) / 100,
            kwh_gross: kwhGross,
            kwh_net: kwhNet,
            cost_gross: Math.round(kwhGross * avgPrice * 100) / 100,
            cost_net: Math.round(kwhNet * avgPrice * 100) / 100,
        };
    });

    // 7. Percentages based on net
    for (const d of devices) {
        d.pct = totalNetKwh > 0 ? Math.round((d.kwh_net / totalNetKwh) * 1000) / 10 : 0;
    }

    return {
        devices,
        total: {
            kwh: Math.round(totalNetKwh * 100) / 100,
            cost_eur: Math.round(totalNetKwh * avgPrice * 100) / 100,
            avg_price_kwh: avgPrice,
        },
    };
};

module.exports = {
    listLines, getLine, createLine, updateLine, deleteLine,
    addDevices, removeDevice, getMembershipLog,
    getSummary, getTimeline, getDeviceBreakdown,
};
