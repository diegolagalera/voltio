const router = require('express').Router();
const authController = require('../controllers/auth.controller');
const auth = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { validate, loginSchema, refreshSchema } = require('../utils/validators');

router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/refresh', validate(refreshSchema), authController.refresh);
router.post('/logout', auth, authController.logout);
router.get('/me', auth, authController.me);

module.exports = router;
