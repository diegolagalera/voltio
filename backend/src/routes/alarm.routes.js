const router = require('express').Router();
const ctrl = require('../controllers/alarm.controller');
const auth = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');

router.use(auth);

router.get('/factory/:factoryId', tenantGuard, ctrl.listAlarms);
router.put('/:id/acknowledge', ctrl.acknowledgeAlarm);

module.exports = router;
