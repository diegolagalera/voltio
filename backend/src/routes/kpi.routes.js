const router = require('express').Router();
const ctrl = require('../controllers/kpi.controller');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { tenantGuard } = require('../middleware/tenantGuard');

// KPI module — only for gerencia (and superadmin for oversight)
router.use(auth, requireRole('gerencia', 'superadmin'));

router.get('/costs/:factoryId', tenantGuard, ctrl.getCosts);
router.get('/carbon/:factoryId', tenantGuard, ctrl.getCarbonFootprint);
router.get('/efficiency/:factoryId', tenantGuard, ctrl.getEfficiency);

module.exports = router;
