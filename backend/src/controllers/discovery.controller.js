const discoveryService = require('../services/discovery.service');

/**
 * GET /api/factories/:factoryId/discoveries
 */
const listDiscoveries = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const { status } = req.query; // ?status=pending

        const discoveries = await discoveryService.getDiscoveries(factoryId, status);

        res.json({ success: true, data: discoveries });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/factories/:factoryId/discoveries/:discoveryId/confirm
 */
const confirmDiscovery = async (req, res, next) => {
    try {
        const { factoryId, discoveryId } = req.params;
        const { name, device_type } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Device name is required' });
        }

        const device = await discoveryService.confirmDevice(
            discoveryId,
            factoryId,
            req.user.id,
            { name: name.trim(), device_type },
        );

        res.status(201).json({ success: true, data: device });
    } catch (err) {
        if (err.message === 'Discovery not found') {
            return res.status(404).json({ success: false, message: err.message });
        }
        if (err.message === 'Device already confirmed') {
            return res.status(409).json({ success: false, message: err.message });
        }
        next(err);
    }
};

/**
 * POST /api/factories/:factoryId/discoveries/:discoveryId/ignore
 */
const ignoreDiscovery = async (req, res, next) => {
    try {
        const { factoryId, discoveryId } = req.params;

        const result = await discoveryService.ignoreDevice(discoveryId, factoryId);

        res.json({ success: true, data: result });
    } catch (err) {
        if (err.message === 'Discovery not found') {
            return res.status(404).json({ success: false, message: err.message });
        }
        next(err);
    }
};

/**
 * POST /api/factories/:factoryId/scan
 */
const triggerScan = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const { scan_range } = req.body;

        discoveryService.triggerScan(factoryId, scan_range);

        res.json({
            success: true,
            message: 'Network scan triggered. Results will appear in discoveries.',
        });
    } catch (err) {
        next(err);
    }
};

module.exports = { listDiscoveries, confirmDiscovery, ignoreDiscovery, triggerScan };
