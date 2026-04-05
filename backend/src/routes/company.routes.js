const router = require('express').Router();
const ctrl = require('../controllers/company.controller');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.use(auth);

router.get('/profile', requireRole('manager', 'gerencia'), ctrl.getProfile);
router.put('/profile', requireRole('manager'), ctrl.updateProfile);
router.get('/factories', ctrl.listFactories);

module.exports = router;
