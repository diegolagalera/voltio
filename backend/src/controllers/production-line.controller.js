/**
 * FPSaver — Production Line Controller
 */
const service = require('../services/production-line.service');
const { getFactoryTimezone, getLocalDateStr, getLocalMidnight } = require('../utils/timezone');

// ── Validate that lineId belongs to factoryId ──
async function validateLineOwnership(req, res) {
    const line = await service.getLine(req.params.factoryId, req.params.lineId);
    if (!line) {
        res.status(404).json({ success: false, message: 'Production line not found in this factory' });
        return null;
    }
    return line;
}

// ── Date range helper (same pattern as report.controller) ──
async function getDateRange(query, factoryId) {
    const tz = await getFactoryTimezone(factoryId);
    const todayStr = getLocalDateStr(tz);

    const toTzString = (dateStr, time) => {
        const midnight = getLocalMidnight(dateStr, tz);
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, timeZoneName: 'longOffset',
        });
        const formatted = formatter.format(midnight);
        const match = formatted.match(/GMT([+-]\d{2}:\d{2})/);
        const offset = match ? match[1] : '+00:00';
        return `${dateStr}T${time}${offset}`;
    };

    if (query.range) {
        const now = new Date();
        switch (query.range) {
            case 'today':
                return { from: toTzString(todayStr, '00:00:00'), to: toTzString(todayStr, '23:59:59') };
            case 'week': {
                const f = new Date(now); f.setDate(f.getDate() - 7);
                return { from: toTzString(getLocalDateStr(tz, f), '00:00:00'), to: toTzString(todayStr, '23:59:59') };
            }
            case 'month': {
                const [y, m] = todayStr.split('-');
                return { from: toTzString(`${y}-${m}-01`, '00:00:00'), to: toTzString(todayStr, '23:59:59') };
            }
            default:
                return { from: toTzString(todayStr, '00:00:00'), to: toTzString(todayStr, '23:59:59') };
        }
    }

    const from = query.from || todayStr;
    const to = query.to || todayStr;
    return {
        from: from.includes('T') ? from : toTzString(from, '00:00:00'),
        to: to.includes('T') ? to : toTzString(to, '23:59:59'),
    };
}

// ════════════════════════════════════════════
// CRUD
// ════════════════════════════════════════════

const listLines = async (req, res, next) => {
    try {
        const data = await service.listLines(req.params.factoryId);
        res.json({ success: true, data });
    } catch (err) { next(err); }
};

const getLine = async (req, res, next) => {
    try {
        const data = await service.getLine(req.params.factoryId, req.params.lineId);
        if (!data) return res.status(404).json({ success: false, message: 'Production line not found' });
        res.json({ success: true, data });
    } catch (err) { next(err); }
};

const createLine = async (req, res, next) => {
    try {
        const { name, description, color } = req.body;
        if (!name?.trim()) return res.status(400).json({ success: false, message: 'Name is required' });
        const data = await service.createLine(req.params.factoryId, { name: name.trim(), description, color });
        res.status(201).json({ success: true, data });
    } catch (err) { next(err); }
};

const updateLine = async (req, res, next) => {
    try {
        const data = await service.updateLine(req.params.factoryId, req.params.lineId, req.body);
        if (!data) return res.status(404).json({ success: false, message: 'Production line not found' });
        res.json({ success: true, data });
    } catch (err) { next(err); }
};

const deleteLine = async (req, res, next) => {
    try {
        const ok = await service.deleteLine(req.params.factoryId, req.params.lineId);
        if (!ok) return res.status(404).json({ success: false, message: 'Production line not found' });
        res.json({ success: true, message: 'Production line deleted' });
    } catch (err) { next(err); }
};

// ════════════════════════════════════════════
// MEMBERSHIP
// ════════════════════════════════════════════

const addDevices = async (req, res, next) => {
    try {
        if (!await validateLineOwnership(req, res)) return;
        const { device_ids } = req.body;
        if (!Array.isArray(device_ids) || !device_ids.length) {
            return res.status(400).json({ success: false, message: 'device_ids array required' });
        }
        const data = await service.addDevices(req.params.lineId, device_ids);
        res.status(201).json({ success: true, data });
    } catch (err) { next(err); }
};

const removeDevice = async (req, res, next) => {
    try {
        if (!await validateLineOwnership(req, res)) return;
        const ok = await service.removeDevice(req.params.lineId, req.params.deviceId);
        if (!ok) return res.status(404).json({ success: false, message: 'Device not in this line' });
        res.json({ success: true, message: 'Device removed from production line' });
    } catch (err) { next(err); }
};

const getMembershipLog = async (req, res, next) => {
    try {
        if (!await validateLineOwnership(req, res)) return;
        const data = await service.getMembershipLog(req.params.lineId);
        res.json({ success: true, data });
    } catch (err) { next(err); }
};

// ════════════════════════════════════════════
// ANALYTICS
// ════════════════════════════════════════════

const getAnalyticsSummary = async (req, res, next) => {
    try {
        if (!await validateLineOwnership(req, res)) return;
        const { factoryId, lineId } = req.params;
        const { from, to } = await getDateRange(req.query, factoryId);
        const data = await service.getSummary(factoryId, lineId, from, to);
        res.json({ success: true, data });
    } catch (err) { next(err); }
};

const getAnalyticsTimeline = async (req, res, next) => {
    try {
        if (!await validateLineOwnership(req, res)) return;
        const { factoryId, lineId } = req.params;
        const { from, to } = await getDateRange(req.query, factoryId);
        const group = req.query.group || 'hour';
        const data = await service.getTimeline(factoryId, lineId, from, to, group);
        res.json({ success: true, data });
    } catch (err) { next(err); }
};

const getAnalyticsDeviceBreakdown = async (req, res, next) => {
    try {
        if (!await validateLineOwnership(req, res)) return;
        const { factoryId, lineId } = req.params;
        const { from, to } = await getDateRange(req.query, factoryId);
        const data = await service.getDeviceBreakdown(factoryId, lineId, from, to);
        res.json({ success: true, data });
    } catch (err) { next(err); }
};

module.exports = {
    listLines, getLine, createLine, updateLine, deleteLine,
    addDevices, removeDevice, getMembershipLog,
    getAnalyticsSummary, getAnalyticsTimeline, getAnalyticsDeviceBreakdown,
};
