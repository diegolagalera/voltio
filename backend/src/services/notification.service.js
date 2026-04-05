/**
 * FPSaver — Notification Service
 * Incident-based notification system for automated system events.
 * 
 * Model:
 *   1. Event detected (e.g. PF < 0.90) → create notification (status: active)
 *   2. Same event in next batch → increment occurrence_count + update last_seen_at
 *   3. Event resolved → update status to 'resolved', create resolution notification
 */

const db = require('../config/database');
const websocket = require('../config/websocket');

/**
 * Check and create/update/resolve an incident-based notification.
 * @param {string} factoryId
 * @param {string} eventType - e.g. 'power_factor_low', 'phase_imbalance', 'power_peak'
 * @param {object} opts
 * @param {boolean} opts.triggered - whether the condition is currently active
 * @param {string} opts.severity - 'info', 'warning', 'critical'
 * @param {string} opts.title - human-readable title
 * @param {string} opts.message - detail message
 * @param {string|null} opts.deviceId - optional device reference
 * @param {object} opts.metadata - extra data (PF value, imbalance %, etc.)
 */
const checkAndNotify = async (factoryId, eventType, opts) => {
    const { triggered, severity = 'warning', title, message, deviceId = null, metadata = {} } = opts;

    try {
        // Find active incident for this event_type + device
        const activeResult = await db.query(
            `SELECT id, occurrence_count, first_seen_at FROM system_notifications
             WHERE factory_id = $1 AND event_type = $2 AND status = 'active'
             ${deviceId ? 'AND device_id = $3' : 'AND device_id IS NULL'}
             LIMIT 1`,
            deviceId ? [factoryId, eventType, deviceId] : [factoryId, eventType]
        );

        const activeIncident = activeResult.rows[0] || null;

        if (triggered) {
            if (activeIncident) {
                // Same event still happening → increment count + reset is_read so badge reappears
                await db.query(
                    `UPDATE system_notifications
                     SET occurrence_count = occurrence_count + 1,
                         last_seen_at = NOW(),
                         title = $2,
                         message = $3,
                         metadata = $4,
                         severity = $5,
                         is_read = false,
                         read_at = NULL
                     WHERE id = $1`,
                    [activeIncident.id, title, message, JSON.stringify(metadata), severity]
                );

                // Emit update so frontend bell shows badge again
                const updated = await db.query('SELECT * FROM system_notifications WHERE id = $1', [activeIncident.id]);
                if (updated.rows[0]) {
                    websocket.emitNotification(factoryId, { type: 'updated', notification: updated.rows[0] });
                }
            } else {
                // New incident → create notification
                const result = await db.query(
                    `INSERT INTO system_notifications
                     (factory_id, device_id, event_type, severity, status, title, message, metadata)
                     VALUES ($1, $2, $3, $4, 'active', $5, $6, $7)
                     RETURNING *`,
                    [factoryId, deviceId, eventType, severity, title, message, JSON.stringify(metadata)]
                );

                const notification = result.rows[0];
                console.log(`[NOTIFICATION] NEW: ${eventType} — ${title} (factory: ${factoryId})`);
                websocket.emitNotification(factoryId, { type: 'new', notification });
            }
        } else {
            // Condition cleared
            if (activeIncident) {
                // Resolve the active incident — reset is_read so user sees the resolution
                await db.query(
                    `UPDATE system_notifications
                     SET status = 'resolved', resolved_at = NOW(),
                         title = $2, message = $3, metadata = $4,
                         is_read = false, read_at = NULL
                     WHERE id = $1`,
                    [activeIncident.id, title, message, JSON.stringify(metadata)]
                );

                const resolved = await db.query('SELECT * FROM system_notifications WHERE id = $1', [activeIncident.id]);
                if (resolved.rows[0]) {
                    console.log(`[NOTIFICATION] RESOLVED: ${eventType} — ${title} (factory: ${factoryId})`);
                    websocket.emitNotification(factoryId, { type: 'resolved', notification: resolved.rows[0] });
                }
            }
            // If no active incident and not triggered → nothing to do
        }
    } catch (err) {
        // Never break the telemetry pipeline because of notification errors
        console.error(`[NOTIFICATION] Error processing ${eventType}:`, err.message);
    }
};

/**
 * Get notifications for a factory (newest first, last 7 days, paginated)
 */
const getNotifications = async (factoryId, { limit = 20, offset = 0, unreadOnly = false } = {}) => {
    const whereClause = unreadOnly
        ? 'AND sn.is_read = false'
        : '';

    const result = await db.query(
        `SELECT sn.*, d.name as device_name
         FROM system_notifications sn
         LEFT JOIN devices d ON d.id = sn.device_id
         WHERE sn.factory_id = $1
           AND sn.created_at >= NOW() - INTERVAL '7 days'
           ${whereClause}
         ORDER BY sn.last_seen_at DESC, sn.created_at DESC
         LIMIT $2 OFFSET $3`,
        [factoryId, limit, offset]
    );

    return result.rows;
};

/**
 * Get unread notification count for a factory
 */
const getUnreadCount = async (factoryId) => {
    const result = await db.query(
        'SELECT COUNT(*) AS count FROM system_notifications WHERE factory_id = $1 AND is_read = false',
        [factoryId]
    );
    return parseInt(result.rows[0]?.count || 0);
};

/**
 * Mark a single notification as read
 */
const markAsRead = async (notificationId, userId) => {
    const result = await db.query(
        `UPDATE system_notifications
         SET is_read = true, read_by = $2, read_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [notificationId, userId]
    );
    return result.rows[0] || null;
};

/**
 * Mark all notifications as read for a factory
 */
const markAllAsRead = async (factoryId, userId) => {
    const result = await db.query(
        `UPDATE system_notifications
         SET is_read = true, read_by = $2, read_at = NOW()
         WHERE factory_id = $1 AND is_read = false`,
        [factoryId, userId]
    );
    return result.rowCount;
};

module.exports = {
    checkAndNotify,
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
};
