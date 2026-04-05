/**
 * FPSaver — Cost Snapshot Job
 * Runs every hour to capture cost snapshots for historical records.
 * 
 * Why: When a factory changes from indexed to fixed contract (or vice versa),
 * the historical cost data is preserved with the exact prices that applied
 * at that moment.
 * 
 * Schedule: Every hour at minute 5 (XX:05)
 */

const cron = require('node-cron');
const db = require('../config/database');
const costService = require('../services/cost.service');

const JOB_NAME = 'cost-snapshot';

/**
 * Take a snapshot of current cost for all factories with active contracts
 */
const captureSnapshots = async () => {
    console.log(`[${JOB_NAME}] Capturing hourly cost snapshots...`);

    try {
        // Get all factories with active contracts
        const factories = await db.query(`
            SELECT DISTINCT c.factory_id, c.id AS contract_id
            FROM contracts c
            WHERE c.is_active = true
            AND c.start_date <= CURRENT_DATE
            AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
        `);

        if (!factories.rows.length) {
            console.log(`[${JOB_NAME}] No active contracts found, skipping.`);
            return;
        }

        const now = new Date();
        let saved = 0;

        for (const row of factories.rows) {
            try {
                const costInfo = await costService.getCurrentCostPerKwh(row.factory_id, now);
                if (!costInfo.price_kwh || costInfo.error) continue;

                // Get REAL average power for the last hour from telemetry hypertable
                // This is the accurate hourly consumption, not an instantaneous snapshot
                const hourStart = new Date(now);
                hourStart.setMinutes(0, 0, 0);
                const hourEnd = new Date(hourStart.getTime() + 3600000);

                let totalKw = 0;

                // Try general meter first (most accurate total factory reading)
                const generalMeter = await db.query(`
                    SELECT AVG(COALESCE(t.power_w_total, 0)) / 1000 AS avg_kw,
                           COUNT(*) AS samples
                    FROM telemetry t
                    JOIN devices d ON d.id = t.device_id
                    WHERE d.factory_id = $1 AND d.is_active = true
                      AND d.device_role = 'general_meter'
                    AND t.time >= $2::timestamptz
                    AND t.time < $3::timestamptz
                `, [row.factory_id, hourStart.toISOString(), hourEnd.toISOString()]);

                if (generalMeter.rows.length > 0 && parseInt(generalMeter.rows[0].samples) > 0) {
                    totalKw = parseFloat(generalMeter.rows[0].avg_kw) || 0;
                } else {
                    // No general meter — sum AVG of all independent sub-meters
                    // Exclude downstream children and phase channels to prevent double-counting
                    const consumption = await db.query(`
                        SELECT COALESCE(SUM(device_avg), 0) AS total_kw FROM (
                            SELECT AVG(t.power_w_total) / 1000 AS device_avg
                            FROM telemetry t
                            JOIN devices d ON d.id = t.device_id
                            WHERE d.factory_id = $1 AND d.is_active = true
                              AND d.device_role IS DISTINCT FROM 'general_meter'
                              AND d.parent_relation IS DISTINCT FROM 'phase_channel'
                              AND d.parent_relation IS DISTINCT FROM 'downstream'
                            AND t.time >= $2::timestamptz
                            AND t.time < $3::timestamptz
                            GROUP BY t.device_id
                        ) per_device
                    `, [row.factory_id, hourStart.toISOString(), hourEnd.toISOString()]);
                    totalKw = parseFloat(consumption.rows[0]?.total_kw) || 0;
                }

                // If no telemetry data in the hypertable for this hour, fall back to realtime
                // BUT only if the realtime data is fresh (< 10 min) — stale data = device is offline
                if (totalKw === 0) {
                    const rtFallback = await db.query(`
                        SELECT tr.data
                        FROM telemetry_realtime tr
                        JOIN devices d ON d.id = tr.device_id
                        WHERE d.factory_id = $1 AND d.is_active = true
                          AND d.device_role = 'general_meter'
                          AND tr.last_updated > NOW() - INTERVAL '10 minutes'
                        LIMIT 1
                    `, [row.factory_id]);
                    if (rtFallback.rows.length > 0) {
                        const data = rtFallback.rows[0].data;
                        totalKw = parseFloat(data?.power_w_total || data?.power_w || 0) / 1000;
                    }
                }

                const kwhConsumed = totalKw; // kW * 1h = kWh (snapshot is hourly)
                const costEur = kwhConsumed * costInfo.price_kwh;

                // Guard: skip if a snapshot already exists for this factory + hour
                // (hourStart/hourEnd already calculated above)
                const existing = await db.query(`
                    SELECT id FROM cost_snapshots
                    WHERE factory_id = $1
                    AND timestamp >= $2 AND timestamp < $3
                    LIMIT 1
                `, [row.factory_id, hourStart.toISOString(), hourEnd.toISOString()]);

                if (existing.rows.length > 0) {
                    console.log(`[${JOB_NAME}] Snapshot already exists for ${row.factory_id} at ${hourStart.toISOString()}, skipping.`);
                    continue;
                }

                await db.query(`
                    INSERT INTO cost_snapshots 
                        (factory_id, contract_id, timestamp, period, 
                         price_kwh, price_kwh_no_tax, kwh_consumed, cost_eur,
                         pricing_model, breakdown)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                `, [
                    row.factory_id,
                    row.contract_id,
                    now,
                    costInfo.period,
                    costInfo.price_kwh,
                    costInfo.price_kwh_no_tax || 0,
                    Math.round(kwhConsumed * 100) / 100,
                    Math.round(costEur * 100) / 100,
                    costInfo.pricing_model,
                    JSON.stringify(costInfo.breakdown),
                ]);

                saved++;
            } catch (err) {
                console.error(`[${JOB_NAME}] Error for factory ${row.factory_id}:`, err.message);
            }
        }

        console.log(`[${JOB_NAME}] ✓ ${saved}/${factories.rows.length} snapshots saved.`);
    } catch (err) {
        console.error(`[${JOB_NAME}] Fatal error:`, err);
    }
};

/**
 * Start the cron job
 */
const startCostSnapshotJob = () => {
    // Run every hour at minute 5
    cron.schedule('5 * * * *', captureSnapshots, {
        timezone: 'Europe/Madrid',
    });

    console.log(`[${JOB_NAME}] ⏰ Hourly cost snapshot job scheduled (XX:05 CET)`);

    // Capture immediately on startup
    setTimeout(captureSnapshots, 5000);
};

module.exports = { startCostSnapshotJob, captureSnapshots };
