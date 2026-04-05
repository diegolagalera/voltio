const db = require('../config/database');
const { getUserFactoryIds } = require('../middleware/tenantGuard');

/**
 * GET /api/company/profile
 */
const getProfile = async (req, res, next) => {
    try {
        const result = await db.query('SELECT * FROM companies WHERE id = $1', [req.user.companyId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        next(err);
    }
};

/**
 * PUT /api/company/profile
 */
const updateProfile = async (req, res, next) => {
    try {
        const { name, address, city, country, timezone } = req.body;
        const result = await db.query(
            `UPDATE companies SET
        name = COALESCE($1, name),
        address = COALESCE($2, address),
        city = COALESCE($3, city),
        country = COALESCE($4, country),
        timezone = COALESCE($5, timezone)
       WHERE id = $6 RETURNING *`,
            [name, address, city, country, timezone, req.user.companyId]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/company/factories
 * Returns factories the user has access to
 */
const listFactories = async (req, res, next) => {
    try {
        const factoryIds = await getUserFactoryIds(req.user);

        if (factoryIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const result = await db.query(
            `SELECT f.*,
        (SELECT COUNT(*) FROM devices d WHERE d.factory_id = f.id AND d.is_active = true) as device_count,
        (SELECT COUNT(*) FROM alarms a WHERE a.factory_id = f.id AND a.acknowledged = false) as active_alarms
       FROM factories f
       WHERE f.id = ANY($1) AND f.is_active = true
       ORDER BY f.name`,
            [factoryIds]
        );

        res.json({ success: true, data: result.rows });
    } catch (err) {
        next(err);
    }
};

module.exports = { getProfile, updateProfile, listFactories };
