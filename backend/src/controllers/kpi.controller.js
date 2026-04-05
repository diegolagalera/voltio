const db = require('../config/database');

/**
 * GET /api/kpi/costs/:factoryId
 * Energy cost analysis
 */
const getCosts = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const { start, end } = req.query;

        const startDate = start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const endDate = end || new Date().toISOString();

        // Get active contract for this factory
        const contractResult = await db.query(
            `SELECT price_kwh_default, tariff_periods, contracted_power_kw, currency
       FROM contracts
       WHERE (factory_id = $1 OR (factory_id IS NULL AND company_id = (
         SELECT company_id FROM factories WHERE id = $1
       )))
       AND is_active = true
       ORDER BY factory_id NULLS LAST
       LIMIT 1`,
            [factoryId]
        );

        const contract = contractResult.rows[0] || { price_kwh_default: 0.15, currency: 'EUR' };

        // Get daily energy consumption
        const energyResult = await db.query(
            `SELECT
         (td.bucket AT TIME ZONE 'Europe/Madrid')::date as date,
         SUM(td.delta_kwh) as total_kwh,
         SUM(td.delta_kvarh) as total_kvarh,
         MAX(td.max_demand_w) as peak_demand_w,
         SUM(td.delta_kwh) * $3 as estimated_cost
       FROM telemetry_daily td
       JOIN devices d ON td.device_id = d.id
       WHERE d.factory_id = $1 AND td.bucket >= $2::timestamptz AND td.bucket <= $4::timestamptz
       GROUP BY (td.bucket AT TIME ZONE 'Europe/Madrid')::date
       ORDER BY date ASC`,
            [factoryId, startDate, contract.price_kwh_default, endDate]
        );

        // Totals
        const totals = energyResult.rows.reduce(
            (acc, row) => ({
                total_kwh: acc.total_kwh + parseFloat(row.total_kwh || 0),
                total_cost: acc.total_cost + parseFloat(row.estimated_cost || 0),
                peak_demand: Math.max(acc.peak_demand, parseFloat(row.peak_demand_w || 0)),
            }),
            { total_kwh: 0, total_cost: 0, peak_demand: 0 }
        );

        res.json({
            success: true,
            data: {
                contract,
                daily: energyResult.rows,
                totals: {
                    ...totals,
                    currency: contract.currency,
                    avg_cost_per_kwh: totals.total_kwh > 0 ? totals.total_cost / totals.total_kwh : 0,
                },
            },
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/kpi/carbon/:factoryId
 * Carbon footprint estimation
 */
const getCarbonFootprint = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const { start, end } = req.query;

        const startDate = start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const endDate = end || new Date().toISOString();

        // Spain average CO2 factor: ~0.2 kg CO2 / kWh (2024, Red Eléctrica)
        const CO2_FACTOR = 0.2;

        const result = await db.query(
            `SELECT
         (td.bucket AT TIME ZONE 'Europe/Madrid')::date as date,
         SUM(td.delta_kwh) as total_kwh,
         SUM(td.delta_kwh) * $3 as co2_kg
       FROM telemetry_daily td
       JOIN devices d ON td.device_id = d.id
       WHERE d.factory_id = $1 AND td.bucket >= $2::timestamptz AND td.bucket <= $4::timestamptz
       GROUP BY (td.bucket AT TIME ZONE 'Europe/Madrid')::date
       ORDER BY date ASC`,
            [factoryId, startDate, CO2_FACTOR, endDate]
        );

        const totalKwh = result.rows.reduce((sum, r) => sum + parseFloat(r.total_kwh || 0), 0);
        const totalCo2 = totalKwh * CO2_FACTOR;

        res.json({
            success: true,
            data: {
                co2_factor_kg_per_kwh: CO2_FACTOR,
                daily: result.rows,
                totals: {
                    total_kwh: totalKwh,
                    total_co2_kg: totalCo2,
                    total_co2_tons: totalCo2 / 1000,
                },
            },
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/kpi/efficiency/:factoryId
 * Energy efficiency metrics
 */
const getEfficiency = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const { start, end } = req.query;

        const startDate = start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const endDate = end || new Date().toISOString();

        // Per-device efficiency
        const result = await db.query(
            `SELECT
         d.id as device_id,
         d.name as device_name,
         d.device_type,
         SUM(td.delta_kwh) as total_kwh,
         AVG(td.avg_power_factor) as avg_power_factor,
         MAX(td.max_demand_w) as peak_demand_w,
         AVG(td.avg_power_w) as avg_power_w
       FROM telemetry_daily td
       JOIN devices d ON td.device_id = d.id
       WHERE d.factory_id = $1 AND td.bucket >= $2::timestamptz AND td.bucket <= $3::timestamptz
       GROUP BY d.id, d.name, d.device_type
       ORDER BY total_kwh DESC`,
            [factoryId, startDate, endDate]
        );

        // Factory-level power factor trend
        const pfTrend = await db.query(
            `SELECT
         th.bucket,
         AVG(th.avg_power_factor) as avg_power_factor
       FROM telemetry_hourly th
       JOIN devices d ON th.device_id = d.id
       WHERE d.factory_id = $1 AND th.bucket >= $2 AND th.bucket <= $3
       GROUP BY th.bucket
       ORDER BY th.bucket ASC`,
            [factoryId, startDate, endDate]
        );

        res.json({
            success: true,
            data: {
                devices: result.rows,
                power_factor_trend: pfTrend.rows,
            },
        });
    } catch (err) {
        next(err);
    }
};

module.exports = { getCosts, getCarbonFootprint, getEfficiency };
