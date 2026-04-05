/**
 * FPSaver — Period Resolver
 * Determines P1–P6 period for any given datetime + tariff_type
 * Based on official 2025 Spanish electricity tariff schedules
 * 
 * Sources:
 *   - Circular 3/2020 CNMC (peajes)
 *   - RD 148/2021 (cargos)
 *   - Orden TED/1487/2024 (2025 update)
 */

const db = require('../config/database');

// Cache holidays (loaded once from DB)
let holidaysCache = null;
let holidaysCacheExpiry = 0;

/**
 * Load holidays from DB (cached for 24h)
 * Returns Map<dateStr, Set<region>>
 */
const loadHolidays = async () => {
    const now = Date.now();
    if (holidaysCache && now < holidaysCacheExpiry) return holidaysCache;

    const result = await db.query(
        'SELECT date, region FROM holidays ORDER BY date'
    );

    // Map: dateStr -> Set of regions
    holidaysCache = new Map();
    for (const r of result.rows) {
        // PostgreSQL DATE columns return JS Date at midnight UTC
        // Use UTC methods to extract the date string correctly
        const d = r.date;
        const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        if (!holidaysCache.has(dateStr)) {
            holidaysCache.set(dateStr, new Set());
        }
        holidaysCache.get(dateStr).add(r.region || 'nacional');
    }

    holidaysCacheExpiry = now + 86400000; // 24h
    return holidaysCache;
};

/**
 * Check if a date is a holiday or weekend
 * @param {Date} date
 * @param {string} [region] - Factory's comunidad_autonoma (e.g. 'pais_vasco')
 * @param {string} [timezone] - IANA timezone for correct date extraction (optional)
 */
const isHolidayOrWeekend = async (date, region, timezone) => {
    // Weekend check — use timezone-aware day if timezone provided
    let dayOfWeek;
    if (timezone) {
        const dayStr = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
        dayOfWeek = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 }[dayStr];
    } else {
        dayOfWeek = date.getDay();
    }
    if (dayOfWeek === 0 || dayOfWeek === 6) return true;

    const holidays = await loadHolidays();
    // Use timezone-aware date string if timezone provided
    let dateStr;
    if (timezone) {
        dateStr = date.toLocaleDateString('en-CA', { timeZone: timezone }); // 'YYYY-MM-DD'
    } else {
        // Fallback: use local methods (works when server is in same TZ as factory)
        const pad = n => String(n).padStart(2, '0');
        dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    if (!holidays.has(dateStr)) return false;

    const regions = holidays.get(dateStr);
    // National holidays apply to ALL factories
    if (regions.has('nacional') || regions.has('national')) return true;
    // Regional holiday only if factory is in that region
    if (region && regions.has(region)) return true;
    // No region specified = only national holidays apply
    return false;
};

/**
 * Get the season for a given month
 * - High A: January, February, July, December
 * - High B: March, November
 * - Mid A: June, August, September
 * - Mid B: April, May
 * - Low: October
 */
const getSeason = (month) => {
    // 1-indexed months
    if ([1, 2, 7, 12].includes(month)) return 'HIGH_A';
    if ([3, 11].includes(month)) return 'HIGH_B';
    if ([6, 8, 9].includes(month)) return 'MID_A';
    if ([4, 5].includes(month)) return 'MID_B';
    return 'LOW'; // October
};

// ═══════════════════════════════════════════
// TARIFF 2.0TD (≤15kW, residential/small)
// Only 3 effective periods: P1(punta), P2(llano), P3(valle)
// ═══════════════════════════════════════════

const resolve2TD = async (date, region) => {
    const hour = date.getHours();
    const isHW = await isHolidayOrWeekend(date, region);

    // Weekends & holidays = P3 (valle) all day
    if (isHW) return 'P3';

    // Weekdays
    if ((hour >= 10 && hour < 14) || (hour >= 18 && hour < 22)) return 'P1'; // Punta
    if ((hour >= 8 && hour < 10) || (hour >= 14 && hour < 18) || (hour >= 22 && hour < 24)) return 'P2'; // Llano
    return 'P3'; // Valle (0-8)
};

// ═══════════════════════════════════════════
// TARIFF 3.0TD (>15kW, business, BT)
// 6 periods based on hour + season + weekend
// ═══════════════════════════════════════════

// Period schedule: [hour] => period, by season
const SCHEDULE_3TD = {
    HIGH_A: { // Jan, Feb, Jul, Dec
        0: 'P6', 1: 'P6', 2: 'P6', 3: 'P6', 4: 'P6', 5: 'P6', 6: 'P6', 7: 'P6',
        8: 'P2', 9: 'P1', 10: 'P1', 11: 'P1', 12: 'P1', 13: 'P1', 14: 'P1',
        15: 'P2', 16: 'P2', 17: 'P2',
        18: 'P3', 19: 'P3', 20: 'P3', 21: 'P3',
        22: 'P5', 23: 'P5',
    },
    HIGH_B: { // Mar, Nov
        0: 'P6', 1: 'P6', 2: 'P6', 3: 'P6', 4: 'P6', 5: 'P6', 6: 'P6', 7: 'P6',
        8: 'P2', 9: 'P1', 10: 'P1', 11: 'P1', 12: 'P1', 13: 'P1', 14: 'P1',
        15: 'P2', 16: 'P2', 17: 'P2',
        18: 'P3', 19: 'P3', 20: 'P3', 21: 'P3',
        22: 'P5', 23: 'P5',
    },
    MID_A: { // Jun, Aug, Sep
        0: 'P6', 1: 'P6', 2: 'P6', 3: 'P6', 4: 'P6', 5: 'P6', 6: 'P6', 7: 'P6',
        8: 'P4', 9: 'P2', 10: 'P2', 11: 'P2', 12: 'P2', 13: 'P2', 14: 'P2',
        15: 'P2', 16: 'P4', 17: 'P4',
        18: 'P3', 19: 'P3', 20: 'P3', 21: 'P3',
        22: 'P5', 23: 'P5',
    },
    MID_B: { // Apr, May
        0: 'P6', 1: 'P6', 2: 'P6', 3: 'P6', 4: 'P6', 5: 'P6', 6: 'P6', 7: 'P6',
        8: 'P4', 9: 'P4', 10: 'P4', 11: 'P4', 12: 'P4', 13: 'P4', 14: 'P4',
        15: 'P4', 16: 'P4', 17: 'P4',
        18: 'P3', 19: 'P3', 20: 'P3', 21: 'P3',
        22: 'P5', 23: 'P5',
    },
    LOW: { // Oct
        0: 'P6', 1: 'P6', 2: 'P6', 3: 'P6', 4: 'P6', 5: 'P6', 6: 'P6', 7: 'P6',
        8: 'P4', 9: 'P4', 10: 'P4', 11: 'P4', 12: 'P4', 13: 'P4', 14: 'P4',
        15: 'P4', 16: 'P4', 17: 'P4',
        18: 'P5', 19: 'P5', 20: 'P5', 21: 'P5',
        22: 'P5', 23: 'P5',
    },
};

const resolve3TD = async (date, region) => {
    const isHW = await isHolidayOrWeekend(date, region);
    if (isHW) return 'P6'; // All weekend/holidays = P6

    const hour = date.getHours();
    const month = date.getMonth() + 1;
    const season = getSeason(month);
    return SCHEDULE_3TD[season][hour] || 'P6';
};

// ═══════════════════════════════════════════
// TARIFF 6.xTD (AT, industrial)
// Same structure as 3.0TD for 6.1TD
// ═══════════════════════════════════════════

const resolve6TD = resolve3TD; // Same period schedule

// ═══════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════

/**
 * Resolve the current tariff period (P1-P6) for a given datetime and tariff type
 * @param {Date} date - The datetime to resolve
 * @param {string} tariffType - One of: '2.0TD', '3.0TD', '6.1TD', etc.
 * @param {string} [region] - Factory's comunidad_autonoma for holiday filtering
 * @returns {Promise<string>} Period name ('P1'...'P6')
 */
const resolvePeriod = async (date, tariffType, region) => {
    switch (tariffType) {
        case '2.0TD':
            return resolve2TD(date, region);
        case '3.0TD':
            return resolve3TD(date, region);
        case '6.1TD':
        case '6.2TD':
        case '6.3TD':
        case '6.4TD':
            return resolve6TD(date, region);
        default:
            return resolve3TD(date, region); // Default to 3.0TD
    }
};

/**
 * Get all 24-hour period schedule for a given date and tariff
 * @param {string} [region] - Factory's comunidad_autonoma
 * @returns {Promise<string[]>} Array of 24 period strings
 */
const getDaySchedule = async (date, tariffType, region) => {
    const schedule = [];
    for (let h = 0; h < 24; h++) {
        const dt = new Date(date);
        dt.setHours(h, 0, 0, 0);
        schedule.push(await resolvePeriod(dt, tariffType, region));
    }
    return schedule;
};

/**
 * Period colors for UI display
 */
const PERIOD_COLORS = {
    P1: '#ef4444', // Red (most expensive)
    P2: '#f97316', // Orange
    P3: '#eab308', // Yellow
    P4: '#22c55e', // Green
    P5: '#06b6d4', // Cyan
    P6: '#6366f1', // Indigo (cheapest)
};

const PERIOD_LABELS = {
    P1: 'Punta',
    P2: 'Llano Alto',
    P3: 'Llano',
    P4: 'Valle Alto',
    P5: 'Valle',
    P6: 'Super Valle',
};

module.exports = {
    resolvePeriod,
    getDaySchedule,
    isHolidayOrWeekend,
    getSeason,
    PERIOD_COLORS,
    PERIOD_LABELS,
};
