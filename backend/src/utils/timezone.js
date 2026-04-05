/**
 * FPSaver — Timezone Utilities
 * 
 * All date operations should use the factory's stored timezone (IANA format).
 * This avoids hardcoded UTC offsets like '+01:00' that break during DST changes.
 * 
 * Uses Node.js built-in Intl API — zero external dependencies.
 * PostgreSQL handles DST correctly via AT TIME ZONE 'timezone_name'.
 */

const db = require('../config/database');

// Cache factory timezones (rarely changes)
const tzCache = new Map();
const TZ_CACHE_TTL = 3600000; // 1 hour

/**
 * Get the IANA timezone for a factory (e.g. 'Europe/Madrid')
 * @param {string} factoryId
 * @returns {Promise<string>}
 */
const getFactoryTimezone = async (factoryId) => {
    const cached = tzCache.get(factoryId);
    if (cached && Date.now() < cached.expires) return cached.tz;

    try {
        const result = await db.query(
            'SELECT timezone FROM factories WHERE id = $1',
            [factoryId]
        );
        const tz = result.rows[0]?.timezone || 'Europe/Madrid';
        tzCache.set(factoryId, { tz, expires: Date.now() + TZ_CACHE_TTL });
        return tz;
    } catch (e) {
        return 'Europe/Madrid'; // safe default for Spain
    }
};

/**
 * Get today's date string (YYYY-MM-DD) in the factory's timezone.
 * Handles DST correctly — never uses toISOString().
 * 
 * @param {string} timezone - IANA timezone (e.g. 'Europe/Madrid')
 * @param {Date} [date] - defaults to now
 * @returns {string} e.g. '2026-03-10'
 */
const getLocalDateStr = (timezone, date = new Date()) => {
    // Intl.DateTimeFormat with 'en-CA' locale gives YYYY-MM-DD format
    return date.toLocaleDateString('en-CA', { timeZone: timezone });
};

/**
 * Get the current hour (0-23) in the factory's timezone.
 * 
 * @param {string} timezone
 * @param {Date} [date]
 * @returns {number}
 */
const getLocalHour = (timezone, date = new Date()) => {
    return parseInt(
        new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: 'numeric',
            hour12: false,
        }).format(date)
    );
};

/**
 * Get a Date object representing midnight of a given date in the factory's timezone.
 * Uses PostgreSQL-compatible approach.
 * 
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string} timezone - IANA timezone
 * @returns {Date} 
 */
const getLocalMidnight = (dateStr, timezone) => {
    // Create a date at midnight in the specified timezone
    // Using Intl to find the correct UTC offset for that date+timezone
    const parts = dateStr.split('-');
    const tempDate = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2], 12, 0, 0));

    // Get the offset for this date in this timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hour12: false, minute: '2-digit',
        timeZoneName: 'longOffset',
    });
    const formatted = formatter.format(tempDate);
    // Extract offset like "GMT+01:00" or "GMT+02:00"
    const offsetMatch = formatted.match(/GMT([+-]\d{2}:\d{2})/);
    const offset = offsetMatch ? offsetMatch[1] : '+00:00';

    return new Date(`${dateStr}T00:00:00${offset}`);
};

/**
 * Build a PostgreSQL expression for midnight of a date in a timezone.
 * Uses AT TIME ZONE which handles DST automatically.
 * 
 * Usage in SQL: WHERE time >= ${toMidnightSQL('$2', tz)}
 * 
 * @param {string} paramRef - SQL parameter reference (e.g. '$2')
 * @param {string} timezone - IANA timezone  
 * @returns {string} SQL expression
 */
const toMidnightSQL = (paramRef, timezone) => {
    // ($2::date)::timestamp AT TIME ZONE 'Europe/Madrid'
    // This creates midnight in the factory's timezone, correctly handling DST
    return `(${paramRef}::date)::timestamp AT TIME ZONE '${timezone}'`;
};

/**
 * Build a PostgreSQL expression for "midnight + 1 day" in a timezone.
 * 
 * @param {string} paramRef
 * @param {string} timezone
 * @returns {string}
 */
const toNextDayMidnightSQL = (paramRef, timezone) => {
    return `((${paramRef}::date + interval '1 day')::timestamp AT TIME ZONE '${timezone}')`;
};

module.exports = {
    getFactoryTimezone,
    getLocalDateStr,
    getLocalHour,
    getLocalMidnight,
    toMidnightSQL,
    toNextDayMidnightSQL,
};
