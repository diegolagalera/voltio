/**
 * FPSaver — Notification Controller
 * API endpoints for system notification management
 */

const notificationService = require('../services/notification.service');

/**
 * GET /api/factories/:factoryId/notifications
 * Query: ?limit=50&unread=true
 */
const getNotifications = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;
        const unreadOnly = req.query.unread === 'true';

        const notifications = await notificationService.getNotifications(factoryId, { limit, offset, unreadOnly });
        res.json({ success: true, data: notifications });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/factories/:factoryId/notifications/unread-count
 */
const getUnreadCount = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const count = await notificationService.getUnreadCount(factoryId);
        res.json({ success: true, data: { count } });
    } catch (err) {
        next(err);
    }
};

/**
 * PUT /api/notifications/:id/read
 */
const markAsRead = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await notificationService.markAsRead(id, req.user.id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }
        res.json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};

/**
 * PUT /api/factories/:factoryId/notifications/read-all
 */
const markAllAsRead = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const count = await notificationService.markAllAsRead(factoryId, req.user.id);
        res.json({ success: true, data: { marked: count } });
    } catch (err) {
        next(err);
    }
};

module.exports = { getNotifications, getUnreadCount, markAsRead, markAllAsRead };
