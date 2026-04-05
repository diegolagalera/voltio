/**
 * FPSaver — ESIOS Service
 * Fetches electricity prices from the ESIOS API (Red Eléctrica de España)
 * 
 * Indicators:
 *   - 600:   Precio mercado SPOT (OMIE) — €/MWh
 *   - 1001:  PVPC total — €/MWh
 *   - 10229: FEU (Facturación Energía Activa PVPC) — €/MWh
 */

const db = require('../config/database');
const config = require('../config/env');

const ESIOS_BASE = config.esios.baseUrl;
const ESIOS_API_KEY = config.esios.apiKey;

const INDICATORS = {
    SPOT_OMIE: { id: 600, type: 'spot_omie', name: 'Precio SPOT OMIE', geoId: 3 },
    PVPC: { id: 1001, type: 'pvpc', name: 'PVPC Total', geoId: 8741 },
};

/**
 * Fetch indicator data from ESIOS API
 * @param {number} indicatorId - ESIOS indicator ID
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 * @param {number} geoId - Geographic zone ID (3=Spain for SPOT, 8741=Peninsula for PVPC)
 * @returns {Array} Array of {datetime, value} objects
 */
const fetchIndicator = async (indicatorId, startDate, endDate, geoId = 3) => {
    // If no API key, use mock data
    if (!ESIOS_API_KEY) {
        console.warn('[ESIOS] No API key configured, using mock data');
        return generateMockPrices(startDate, endDate);
    }

    const url = `${ESIOS_BASE}/indicators/${indicatorId}?start_date=${startDate}T00:00:00&end_date=${endDate}T23:59:59&geo_ids[]=${geoId}`;

    const response = await fetch(url, {
        headers: {
            'x-api-key': ESIOS_API_KEY,
            'Accept': 'application/json; application/vnd.esios-api-v1+json',
        },
    });

    if (!response.ok) {
        throw new Error(`ESIOS API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    return (data.indicator?.values || []).map(v => ({
        datetime: v.datetime,
        value: v.value, // €/MWh
        geo_id: v.geo_id,
    }));
};

/**
 * Generate realistic mock prices for development (no ESIOS key needed)
 * Follows typical Spanish market patterns
 */
const generateMockPrices = (startDate, endDate) => {
    const prices = [];
    const start = new Date(startDate + 'T00:00:00+01:00');
    const end = new Date(endDate + 'T23:59:59+01:00');

    for (let d = new Date(start); d <= end; d.setHours(d.getHours() + 1)) {
        const hour = d.getHours();
        const dayOfWeek = d.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        // Base price follows typical daily curve
        let basePrice;
        if (hour >= 0 && hour < 7) {
            basePrice = 35 + Math.random() * 15; // Valle: 35-50 €/MWh
        } else if (hour >= 7 && hour < 10) {
            basePrice = 65 + Math.random() * 25; // Subida: 65-90
        } else if (hour >= 10 && hour < 14) {
            basePrice = 85 + Math.random() * 40; // Punta mañana: 85-125
        } else if (hour >= 14 && hour < 18) {
            basePrice = 55 + Math.random() * 20; // Bajada: 55-75
        } else if (hour >= 18 && hour < 22) {
            basePrice = 90 + Math.random() * 50; // Punta noche: 90-140
        } else {
            basePrice = 45 + Math.random() * 20; // Bajada noche: 45-65
        }

        // Weekend discount
        if (isWeekend) basePrice *= 0.7;

        prices.push({
            datetime: d.toISOString(),
            value: Math.round(basePrice * 100) / 100,
            geo_id: 3,
        });
    }

    return prices;
};

/**
 * Fetch and store prices for a specific date
 * @param {string} date - YYYY-MM-DD
 */
const syncPricesForDate = async (date) => {
    console.log(`[ESIOS] Syncing prices for ${date}...`);
    let totalStored = 0;

    for (const [key, indicator] of Object.entries(INDICATORS)) {
        try {
            const values = await fetchIndicator(indicator.id, date, date, indicator.geoId);

            if (!values.length) {
                console.warn(`[ESIOS] No data for ${indicator.name} on ${date}`);
                continue;
            }

            // Upsert prices — delete old data for this date+type first, then insert clean
            const TZ = 'Europe/Madrid';
            await db.query(
                `DELETE FROM electricity_prices
                 WHERE price_type = $1
                 AND time >= ($2::date)::timestamp AT TIME ZONE '${TZ}'
                 AND time < (($2::date + interval '1 day')::timestamp AT TIME ZONE '${TZ}')`,
                [indicator.type, date]
            );

            for (const v of values) {
                await db.query(
                    `INSERT INTO electricity_prices (time, price_type, price_eur_mwh, geo_id, source, indicator_id)
                     VALUES ($1, $2, $3, $4, 'esios', $5)`,
                    [v.datetime, indicator.type, v.value, v.geo_id || indicator.geoId, indicator.id]
                );
                totalStored++;
            }

            console.log(`[ESIOS] ${indicator.name}: ${values.length} intervals stored for ${date}`);
        } catch (err) {
            console.error(`[ESIOS] Error fetching ${indicator.name}:`, err.message);
        }
    }

    return totalStored;
};

/**
 * Get stored prices for a date range
 * @param {string} priceType - 'spot_omie' or 'pvpc'
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array} Array of {time, price_eur_mwh}
 */
const getPrices = async (priceType, startDate, endDate) => {
    // ESIOS prices are always peninsular Spanish time
    const TZ = 'Europe/Madrid';
    const result = await db.query(
        `SELECT time, price_eur_mwh
         FROM electricity_prices
         WHERE price_type = $1
         AND time >= ($2::date)::timestamp AT TIME ZONE '${TZ}'
         AND time < (($3::date + interval '1 day')::timestamp AT TIME ZONE '${TZ}')
         ORDER BY time ASC`,
        [priceType, startDate, endDate]
    );
    return result.rows;
};

/**
 * Get the current price (latest hour)
 */
const getCurrentPrice = async (priceType = 'spot_omie') => {
    const result = await db.query(
        `SELECT time, price_eur_mwh
         FROM electricity_prices
         WHERE price_type = $1
         AND time <= NOW()
         ORDER BY time DESC
         LIMIT 1`,
        [priceType]
    );
    return result.rows[0] || null;
};

/**
 * Backfill missing days (up to N days back)
 * Called on startup to ensure we have data
 */
const backfillMissingDays = async (daysBack = 7) => {
    const today = new Date();
    // Use locale-aware date to avoid UTC midnight shift
    const toDateStr = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
    let filled = 0;

    for (let i = 0; i <= daysBack; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = toDateStr(date);

        // Check if we already have data for this date
        const existing = await db.query(
            `SELECT COUNT(*) as count FROM electricity_prices
              WHERE time >= ($1::date)::timestamp AT TIME ZONE 'Europe/Madrid'
              AND time < (($1::date + interval '1 day')::timestamp AT TIME ZONE 'Europe/Madrid')`,
            [dateStr]
        );

        if (parseInt(existing.rows[0].count) < 40) { // Less than 40 intervals (expect ~120: 96 SPOT + 24 PVPC)
            await syncPricesForDate(dateStr);
            filled++;
        }
    }

    if (filled > 0) {
        console.log(`[ESIOS] Backfilled ${filled} days of price data`);
    }

    return filled;
};

module.exports = {
    fetchIndicator,
    syncPricesForDate,
    getPrices,
    getCurrentPrice,
    backfillMissingDays,
    INDICATORS,
};
