/**
 * FPSaver — Production Line Routes
 */
const router = require('express').Router();
const ctrl = require('../controllers/production-line.controller');
const auth = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { requireRole } = require('../middleware/rbac');

router.use(auth);

// CRUD (manager+ can create/edit, all can view)
router.get('/:factoryId/production-lines', tenantGuard, ctrl.listLines);
router.post('/:factoryId/production-lines', requireRole('manager', 'superadmin'), tenantGuard, ctrl.createLine);
router.get('/:factoryId/production-lines/:lineId', tenantGuard, ctrl.getLine);
router.put('/:factoryId/production-lines/:lineId', requireRole('manager', 'superadmin'), tenantGuard, ctrl.updateLine);
router.delete('/:factoryId/production-lines/:lineId', requireRole('manager', 'superadmin'), tenantGuard, ctrl.deleteLine);

// Membership management (manager+)
router.post('/:factoryId/production-lines/:lineId/devices', requireRole('manager', 'superadmin'), tenantGuard, ctrl.addDevices);
router.delete('/:factoryId/production-lines/:lineId/devices/:deviceId', requireRole('manager', 'superadmin'), tenantGuard, ctrl.removeDevice);
router.get('/:factoryId/production-lines/:lineId/membership-log', tenantGuard, ctrl.getMembershipLog);

// Analytics (all authenticated users with factory access)
router.get('/:factoryId/production-lines/:lineId/analytics/summary', tenantGuard, ctrl.getAnalyticsSummary);
router.get('/:factoryId/production-lines/:lineId/analytics/timeline', tenantGuard, ctrl.getAnalyticsTimeline);
router.get('/:factoryId/production-lines/:lineId/analytics/device-breakdown', tenantGuard, ctrl.getAnalyticsDeviceBreakdown);

module.exports = router;
