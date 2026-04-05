const router = require('express').Router();
const ctrl = require('../controllers/discovery.controller');
const auth = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { requireRole } = require('../middleware/rbac');

router.use(auth);

router.get('/:factoryId/discoveries', requireRole('manager', 'superadmin'), tenantGuard, ctrl.listDiscoveries);
router.post('/:factoryId/discoveries/:discoveryId/confirm', requireRole('manager', 'superadmin'), tenantGuard, ctrl.confirmDiscovery);
router.post('/:factoryId/discoveries/:discoveryId/ignore', requireRole('manager', 'superadmin'), tenantGuard, ctrl.ignoreDiscovery);
router.post('/:factoryId/scan', requireRole('manager', 'superadmin'), tenantGuard, ctrl.triggerScan);

module.exports = router;
