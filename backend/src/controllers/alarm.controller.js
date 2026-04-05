const db = require('../config/database');

/**
 * GET /api/alarms/factory/:factoryId
 */
const listAlarms = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const { acknowledged } = req.query;

        let query = `
      SELECT a.*, d.name as device_name
      FROM alarms a
      LEFT JOIN devices d ON a.device_id = d.id
      WHERE a.factory_id = $1
    `;
        const params = [factoryId];

        if (acknowledged !== undefined) {
            query += ' AND a.acknowledged = $2';
            params.push(acknowledged === 'true');
        }

        query += ' ORDER BY a.triggered_at DESC LIMIT 100';

        const result = await db.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        next(err);
    }
};

/**
 * PUT /api/alarms/:id/acknowledge
 */
const acknowledgeAlarm = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            `UPDATE alarms SET
        acknowledged = true,
        acknowledged_by = $1,
        acknowledged_at = NOW()
       WHERE id = $2 RETURNING *`,
            [req.user.id, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Alarm not found' });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        next(err);
    }
};

module.exports = { listAlarms, acknowledgeAlarm };
