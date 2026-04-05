const router = require('express').Router();
const ctrl = require('../controllers/factory.controller');
const auth = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { requireRole } = require('../middleware/rbac');
const { validate, createDeviceSchema } = require('../utils/validators');

router.use(auth);

router.get('/:factoryId', tenantGuard, ctrl.getFactory);
router.get('/:factoryId/devices', tenantGuard, ctrl.listDevices);
router.post('/:factoryId/devices', requireRole('manager', 'superadmin'), tenantGuard, validate(createDeviceSchema), ctrl.createDevice);
router.put('/:factoryId/devices/:deviceId', requireRole('manager', 'superadmin'), tenantGuard, ctrl.updateDevice);
router.post('/:factoryId/devices/:deviceId/phase-children', requireRole('manager', 'superadmin'), tenantGuard, ctrl.createPhaseChildren);

// MQTT Credentials
router.get('/:factoryId/mqtt-credentials', requireRole('manager', 'superadmin'), tenantGuard, ctrl.getMqttCredentials);
router.post('/:factoryId/mqtt-credentials/regenerate', requireRole('manager', 'superadmin'), tenantGuard, ctrl.regenerateMqttCredentials);
router.get('/:factoryId/download-config', requireRole('manager', 'superadmin'), tenantGuard, ctrl.downloadConfig);

// Graph node positions (any authenticated user with factory access)
router.get('/:factoryId/graph-positions', tenantGuard, ctrl.getGraphPositions);
router.put('/:factoryId/graph-positions', tenantGuard, ctrl.saveGraphPositions);
router.delete('/:factoryId/graph-positions', tenantGuard, ctrl.resetGraphPositions);

module.exports = router;
