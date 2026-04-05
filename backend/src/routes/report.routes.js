/**
 * FPSaver — Report Routes
 */
const router = require('express').Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/report.controller');

router.use(auth);

router.get('/factories/:factoryId/reports/summary', ctrl.getReportSummary);
router.get('/factories/:factoryId/reports/cost-by-period', ctrl.getCostByPeriod);
router.get('/factories/:factoryId/reports/power-demand', ctrl.getPowerDemand);
router.get('/factories/:factoryId/reports/device-breakdown', ctrl.getDeviceBreakdown);
router.get('/factories/:factoryId/reports/power-quality', ctrl.getPowerQuality);
router.get('/factories/:factoryId/reports/device/:deviceId', ctrl.getDeviceReport);

module.exports = router;
