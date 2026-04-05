/**
 * FPSaver — Report Controller
 * Serves aggregated energy report data for the frontend
 */

const reportService = require('../services/report.service');
const { getFactoryTimezone, getLocalDateStr, getLocalMidnight } = require('../utils/timezone');

/**
 * GET /factories/:factoryId/reports/summary?from=&to=
 */
const getReportSummary = async (req, res) => {
    try {
        const { factoryId } = req.params;
        const { from, to } = await getDateRange(req.query, factoryId);
        const data = await reportService.getSummary(factoryId, from, to);
        res.json({ data });
    } catch (err) {
        console.error('[Report] Summary error:', err.message || err);
        res.status(500).json({ error: 'Error generating summary' });
    }
};

/**
 * GET /factories/:factoryId/reports/cost-by-period?from=&to=&group=hour|day
 */
const getCostByPeriod = async (req, res) => {
    try {
        const { factoryId } = req.params;
        const { from, to } = await getDateRange(req.query, factoryId);
        const group = req.query.group || 'day';
        const data = await reportService.getCostByPeriod(factoryId, from, to, group);
        res.json({ data });
    } catch (err) {
        console.error('[Report] Cost by period error:', err.message || err);
        res.status(500).json({ error: 'Error generating cost breakdown' });
    }
};

/**
 * GET /factories/:factoryId/reports/power-demand?from=&to=
 */
const getPowerDemand = async (req, res) => {
    try {
        const { factoryId } = req.params;
        const { from, to } = await getDateRange(req.query, factoryId);
        const data = await reportService.getPowerDemand(factoryId, from, to);
        res.json({ data });
    } catch (err) {
        console.error('[Report] Power demand error:', err.message || err);
        res.status(500).json({ error: 'Error generating power demand' });
    }
};

/**
 * GET /factories/:factoryId/reports/device-breakdown?from=&to=
 */
const getDeviceBreakdown = async (req, res) => {
    try {
        const { factoryId } = req.params;
        const { from, to } = await getDateRange(req.query, factoryId);
        const data = await reportService.getDeviceBreakdown(factoryId, from, to);
        res.json({ data });
    } catch (err) {
        console.error('[Report] Device breakdown error:', err.message || err);
        res.status(500).json({ error: 'Error generating device breakdown' });
    }
};

/**
 * Helper: parse from/to dates from query params
 * Returns { from, to } as timezone-aware strings for PostgreSQL
 * Uses the factory's stored timezone (handles DST automatically)
 */
async function getDateRange(query, factoryId) {
    const tz = await getFactoryTimezone(factoryId);
    const now = new Date();
    const todayStr = getLocalDateStr(tz);

    // Build a timezone-aware ISO string from a date string
    const toTzString = (dateStr, time) => {
        const midnight = getLocalMidnight(dateStr, tz);
        // Extract the offset from the midnight Date
        const offsetMs = -midnight.getTimezoneOffset() * 60000;
        // Actually, use the factory's timezone to build the offset
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            timeZoneName: 'longOffset',
        });
        const formatted = formatter.format(midnight);
        const match = formatted.match(/GMT([+-]\d{2}:\d{2})/);
        const offset = match ? match[1] : '+00:00';
        return `${dateStr}T${time}${offset}`;
    };

    if (query.range) {
        switch (query.range) {
            case 'today': {
                return { from: toTzString(todayStr, '00:00:00'), to: toTzString(todayStr, '23:59:59') };
            }
            case 'week': {
                const from = new Date(now);
                from.setDate(from.getDate() - 7);
                const fromStr = getLocalDateStr(tz, from);
                return { from: toTzString(fromStr, '00:00:00'), to: toTzString(todayStr, '23:59:59') };
            }
            case 'month': {
                const year = parseInt(todayStr.split('-')[0]);
                const month = parseInt(todayStr.split('-')[1]);
                const fromStr = `${year}-${String(month).padStart(2, '0')}-01`;
                return { from: toTzString(fromStr, '00:00:00'), to: toTzString(todayStr, '23:59:59') };
            }
            default: {
                return { from: toTzString(todayStr, '00:00:00'), to: toTzString(todayStr, '23:59:59') };
            }
        }
    }

    // Custom date range
    const from = query.from || todayStr;
    const to = query.to || todayStr;

    return {
        from: from.includes('T') ? from : toTzString(from, '00:00:00'),
        to: to.includes('T') ? to : toTzString(to, '23:59:59'),
    };
}

/**
 * GET /factories/:factoryId/reports/power-quality?from=&to=
 */
const getPowerQuality = async (req, res) => {
    try {
        const { factoryId } = req.params;
        const { from, to } = await getDateRange(req.query, factoryId);
        const data = await reportService.getPowerQuality(factoryId, from, to);
        res.json({ data });
    } catch (err) {
        console.error('[Report] Power quality error:', err.message || err);
        res.status(500).json({ error: 'Error generating power quality report' });
    }
};

/**
 * GET /factories/:factoryId/reports/device/:deviceId?from=&to=
 */
const getDeviceReport = async (req, res) => {
    try {
        const { factoryId, deviceId } = req.params;
        const { from, to } = await getDateRange(req.query, factoryId);
        const data = await reportService.getDeviceReport(factoryId, deviceId, from, to);
        if (data.error && !data.device) {
            return res.status(404).json({ error: data.error });
        }
        res.json({ data });
    } catch (err) {
        console.error('[Report] Device report error:', err.message || err);
        res.status(500).json({ error: 'Error generating device report' });
    }
};

module.exports = {
    getReportSummary,
    getCostByPeriod,
    getPowerDemand,
    getDeviceBreakdown,
    getPowerQuality,
    getDeviceReport,
};

