/**
 * FPSaver — Cost Service
 * Calculates electricity cost based on:
 *   - Factory's contract (tariff type, pricing model)
 *   - Current period (P1-P6)
 *   - ESIOS market prices (for indexed/PVPC)
 *   - Peajes + Cargos (regulated)
 *   - Taxes (electricity tax + IVA)
 */

const db = require('../config/database');
const { resolvePeriod, getDaySchedule, PERIOD_COLORS, PERIOD_LABELS } = require('../utils/period-resolver');
const esiosService = require('./esios.service');
const { getFactoryTimezone, getLocalDateStr, getLocalHour, toMidnightSQL, toNextDayMidnightSQL } = require('../utils/timezone');

/**
 * Get the active contract for a factory
 */
const getActiveContract = async (factoryId) => {
    const result = await db.query(
        `SELECT c.*, f.comunidad_autonoma AS factory_region
         FROM contracts c
         JOIN factories f ON f.id = c.factory_id
         WHERE c.factory_id = $1
         AND c.is_active = true
         AND c.start_date <= CURRENT_DATE
         AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
         ORDER BY c.created_at DESC
         LIMIT 1`,
        [factoryId]
    );
    return result.rows[0] || null;
};

/**
 * Get the energy price per kWh for the current hour
 * This is the FULL price including all components
 * 
 * @param {string} factoryId
 * @param {Date} [date] - defaults to now
 * @returns {object} { price_kwh, period, breakdown, color, label }
 */
const getCurrentCostPerKwh = async (factoryId, date = new Date()) => {
    const contract = await getActiveContract(factoryId);

    if (!contract) {
        return {
            price_kwh: 0,
            period: null,
            breakdown: null,
            error: 'No hay contrato activo configurado',
        };
    }

    const region = contract.factory_region || 'nacional';
    const period = await resolvePeriod(date, contract.tariff_type || '6.1TD', region);
    const periodNum = parseInt(period.substring(1)); // 'P1' -> 1

    // Get energy cost based on pricing model
    let energyPrice = 0; // €/kWh

    switch (contract.pricing_model) {
        case 'fixed': {
            // Use the fixed price from the contract
            const priceField = `energy_price_p${periodNum}`;
            energyPrice = contract[priceField] || contract.price_kwh_default || 0.15;
            break;
        }
        case 'indexed_omie': {
            // Spot price + margin
            const spot = await esiosService.getCurrentPrice('spot_omie');
            const spotKwh = spot ? spot.price_eur_mwh / 1000 : 0.10; // €/MWh → €/kWh
            energyPrice = spotKwh + (contract.indexed_margin || 0);
            break;
        }
        case 'pvpc': {
            // Direct PVPC price
            const pvpc = await esiosService.getCurrentPrice('pvpc');
            energyPrice = pvpc ? pvpc.price_eur_mwh / 1000 : 0.12;
            break;
        }
        default:
            energyPrice = contract.price_kwh_default || 0.15;
    }

    // Add regulated components
    const peajeField = `peaje_p${periodNum}`;
    const cargoField = `cargo_p${periodNum}`;
    const peaje = contract[peajeField] || 0;
    const cargo = contract[cargoField] || 0;

    // Total before taxes
    const subtotal = energyPrice + peaje + cargo;

    // Apply taxes
    const electricityTax = contract.electricity_tax || 5.1127;
    const iva = contract.iva || 21.0;

    const afterElecTax = subtotal * (1 + electricityTax / 100);
    const totalWithIva = afterElecTax * (1 + iva / 100);

    return {
        price_kwh: Math.round(totalWithIva * 10000) / 10000, // €/kWh with 4 decimals
        price_kwh_no_tax: Math.round(subtotal * 10000) / 10000,
        period,
        period_label: PERIOD_LABELS[period],
        color: PERIOD_COLORS[period],
        tariff_type: contract.tariff_type,
        pricing_model: contract.pricing_model,
        contracted_power_kw: parseFloat(contract[`power_p${periodNum}_kw`]) || 0,
        contract_id: contract.id,
        breakdown: {
            energy: Math.round(energyPrice * 10000) / 10000,
            peaje: Math.round(peaje * 10000) / 10000,
            cargo: Math.round(cargo * 10000) / 10000,
            subtotal: Math.round(subtotal * 10000) / 10000,
            electricity_tax_pct: electricityTax,
            iva_pct: iva,
            total: Math.round(totalWithIva * 10000) / 10000,
        },
    };
};

/**
 * Calculate cost for a specific device based on its current power consumption
 * @returns {object} { cost_per_hour, cost_per_kwh, power_kw, period }
 */
const getDeviceCostEstimate = async (factoryId, deviceId) => {
    // Get current cost per kWh
    const costInfo = await getCurrentCostPerKwh(factoryId);
    if (!costInfo.price_kwh) return { ...costInfo, cost_per_hour: 0 };

    // Get current power reading from realtime cache
    const rt = await db.query(
        "SELECT data FROM telemetry_realtime WHERE device_id = $1",
        [deviceId]
    );

    if (!rt.rows[0]) {
        return { ...costInfo, cost_per_hour: 0, power_kw: 0 };
    }

    const data = rt.rows[0].data;
    const powerKw = (data.power_w_total || data.power_w || 0) / 1000;

    return {
        ...costInfo,
        power_kw: Math.round(powerKw * 100) / 100,
        cost_per_hour: Math.round(powerKw * costInfo.price_kwh * 100) / 100, // €/h
    };
};

/**
 * Get daily cost breakdown (24h bars)
 * Uses hourly aggregates from telemetry_hourly
 */
const getDailyCostBreakdown = async (factoryId, date) => {
    const contract = await getActiveContract(factoryId);
    if (!contract) return { hours: [], total_cost: 0, total_kwh: 0, error: 'No contract' };

    const tariffType = contract.tariff_type || '6.1TD';
    const tz = contract.factory_region ? await getFactoryTimezone(factoryId) : 'Europe/Madrid';
    const dateStr = typeof date === 'string' ? date : getLocalDateStr(tz, date);

    // Build timezone-aware SQL expressions
    const dayStart = toMidnightSQL('$2', tz);
    const dayEnd = toNextDayMidnightSQL('$2', tz);

    // Find the Contador General (main meter) — identified by device_role
    const generalResult = await db.query(
        `SELECT id FROM devices
         WHERE factory_id = $1 AND is_active = true
         AND device_role = 'general_meter'
         LIMIT 1`,
        [factoryId]
    );

    let hourlyQuery, hourlyParams;

    if (generalResult.rows.length > 0) {
        // Use Contador General only (real total factory meter)
        const generalId = generalResult.rows[0].id;
        hourlyQuery = `SELECT
            time_bucket('1 hour', time, '${tz}') AS hour,
            AVG(COALESCE(power_w_total, 0)) / 1000 AS avg_power_kw,
            COUNT(*) as samples
         FROM telemetry
         WHERE device_id = $1
         AND time >= ${dayStart}
         AND time < ${dayEnd}
         GROUP BY hour
         ORDER BY hour`;
        hourlyParams = [generalId, dateStr];
    } else {
        // No general meter found — sum all independent sub-meters
        // Exclude phase_channel and downstream to prevent double-counting
        hourlyQuery = `SELECT
            hour,
            COALESCE(SUM(device_avg_kw), 0) AS avg_power_kw,
            SUM(sample_count) AS samples
         FROM (
            SELECT
                t.device_id,
                time_bucket('1 hour', t.time, '${tz}') AS hour,
                AVG(COALESCE(t.power_w_total, 0)) / 1000 AS device_avg_kw,
                COUNT(*) AS sample_count
            FROM telemetry t
            JOIN devices d ON d.id = t.device_id
            WHERE d.factory_id = $1 AND d.is_active = true
              AND d.device_role IS DISTINCT FROM 'general_meter'
              AND d.parent_relation IS DISTINCT FROM 'phase_channel'
              AND d.parent_relation IS DISTINCT FROM 'downstream'
            AND t.time >= ${dayStart}
            AND t.time < ${dayEnd}
            GROUP BY t.device_id, hour
         ) per_device
         GROUP BY hour
         ORDER BY hour`;
        hourlyParams = [factoryId, dateStr];
    }

    // Get hourly aggregates for the day
    const hourlyResult = await db.query(hourlyQuery, hourlyParams);

    // Get day schedule (24 periods) — use factory timezone for correct DST handling
    const { getLocalMidnight } = require('../utils/timezone');
    const dt = getLocalMidnight(dateStr, tz);
    const region = contract.factory_region || 'nacional';
    const schedule = await getDaySchedule(dt, tariffType, region);

    // For indexed/pvpc pricing, fetch all prices for the day once (may be 15-min or hourly)
    let dayPrices = [];
    if (contract.pricing_model !== 'fixed') {
        dayPrices = await esiosService.getPrices(
            contract.pricing_model === 'pvpc' ? 'pvpc' : 'spot_omie',
            dateStr, dateStr
        );
    }

    // Calculate cost per hour
    const hours = [];
    let totalCost = 0;
    let totalKwh = 0;

    for (let h = 0; h < 24; h++) {
        const period = schedule[h];
        const periodNum = parseInt(period.substring(1));

        // Get energy price for this hour
        let priceKwh = 0;

        if (contract.pricing_model === 'fixed') {
            priceKwh = contract[`energy_price_p${periodNum}`] || contract.price_kwh_default || 0.15;
        } else {
            // Average all price intervals that fall within this hour (handles both 15-min and hourly data)
            const hourPrices = dayPrices.filter(p => {
                const pHour = new Date(p.time).toLocaleString('en-GB', { timeZone: tz, hour: '2-digit', hour12: false });
                return parseInt(pHour) === h;
            });
            if (hourPrices.length > 0) {
                const avgMwh = hourPrices.reduce((sum, p) => sum + parseFloat(p.price_eur_mwh), 0) / hourPrices.length;
                priceKwh = avgMwh / 1000 + (contract.indexed_margin || 0);
            } else {
                priceKwh = 0.10; // fallback
            }
        }

        // Add peajes + cargos
        const peaje = contract[`peaje_p${periodNum}`] || 0;
        const cargo = contract[`cargo_p${periodNum}`] || 0;
        const totalPrice = priceKwh + peaje + cargo;

        // Find matching telemetry hour
        const hourData = hourlyResult.rows.find(r => getLocalHour(tz, new Date(r.hour)) === h);
        // Use avg_power_kw × 1 hour = kWh consumed in that hour
        const kwh = hourData ? parseFloat(hourData.avg_power_kw) || 0 : 0;
        const cost = kwh * totalPrice;

        hours.push({
            hour: h,
            period,
            period_label: PERIOD_LABELS[period],
            color: PERIOD_COLORS[period],
            price_kwh: Math.round(totalPrice * 10000) / 10000,
            kwh: Math.round(kwh * 100) / 100,
            cost: Math.round(cost * 100) / 100,
        });

        totalCost += cost;
        totalKwh += kwh;
    }

    // Apply taxes
    const electricityTax = contract.electricity_tax || 5.1127;
    const iva = contract.iva || 21.0;
    const totalWithTax = totalCost * (1 + electricityTax / 100) * (1 + iva / 100);

    return {
        date: dateStr,
        tariff_type: tariffType,
        pricing_model: contract.pricing_model,
        hours,
        total_kwh: Math.round(totalKwh * 100) / 100,
        total_cost_net: Math.round(totalCost * 100) / 100,
        total_cost: Math.round(totalWithTax * 100) / 100,
        electricity_tax_pct: electricityTax,
        iva_pct: iva,
    };
};

module.exports = {
    getActiveContract,
    getCurrentCostPerKwh,
    getDeviceCostEstimate,
    getDailyCostBreakdown,
};
