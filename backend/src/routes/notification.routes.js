const router = require('express').Router();
const ctrl = require('../controllers/notification.controller');
const auth = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');

router.use(auth);

// Factory-scoped notification endpoints
router.get('/factories/:factoryId/notifications', tenantGuard, ctrl.getNotifications);
router.get('/factories/:factoryId/notifications/unread-count', tenantGuard, ctrl.getUnreadCount);
router.put('/factories/:factoryId/notifications/read-all', tenantGuard, ctrl.markAllAsRead);

// Single notification
router.put('/notifications/:id/read', ctrl.markAsRead);

module.exports = router;
