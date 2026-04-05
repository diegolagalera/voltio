const router = require('express').Router();
const ctrl = require('../controllers/user.controller');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate, createUserSchema, updateUserSchema, updateUserAccessSchema } = require('../utils/validators');

// All routes require manager role
router.use(auth, requireRole('manager'));

router.get('/', ctrl.listUsers);
router.post('/', validate(createUserSchema), ctrl.createUser);
router.put('/:id', validate(updateUserSchema), ctrl.updateUser);
router.put('/:id/access', validate(updateUserAccessSchema), ctrl.updateUserAccess);
router.delete('/:id', ctrl.deactivateUser);

module.exports = router;
