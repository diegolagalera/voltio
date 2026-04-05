const db = require('../config/database');

/**
 * Tenant guard middleware
 * Ensures users can only access resources belonging to their company
 * and that operador/gerencia users have explicit factory access
 */
const tenantGuard = async (req, res, next) => {
    try {
        // SuperAdmin bypasses all tenant checks
        if (req.user.role === 'superadmin') {
            return next();
        }

        // Check factory access if factory_id is in the route
        const factoryId = req.params.factoryId || req.params.id || req.body.factory_id;

        if (factoryId) {
            // First, verify the factory belongs to the user's company
            const factoryResult = await db.query(
                'SELECT id, company_id FROM factories WHERE id = $1',
                [factoryId]
            );

            if (factoryResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Factory not found',
                });
            }

            const factory = factoryResult.rows[0];
            if (factory.company_id !== req.user.companyId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied - resource belongs to another company',
                });
            }

            // Manager has access to ALL factories in their company
            if (req.user.role === 'manager') {
                req.factory = factory;
                return next();
            }

            // Gerencia / Operador need explicit factory access
            const accessResult = await db.query(
                'SELECT id FROM user_factory_access WHERE user_id = $1 AND factory_id = $2',
                [req.user.id, factoryId]
            );

            if (accessResult.rows.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied - no access to this factory',
                });
            }

            req.factory = factory;
        }

        next();
    } catch (err) {
        console.error('[TenantGuard] Error:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

/**
 * Get list of factory IDs the user has access to
 * @param {object} user - req.user
 * @returns {Promise<string[]>} Array of factory UUIDs
 */
const getUserFactoryIds = async (user) => {
    if (user.role === 'superadmin') {
        const result = await db.query('SELECT id FROM factories WHERE is_active = true');
        return result.rows.map((r) => r.id);
    }

    if (user.role === 'manager') {
        const result = await db.query(
            'SELECT id FROM factories WHERE company_id = $1 AND is_active = true',
            [user.companyId]
        );
        return result.rows.map((r) => r.id);
    }

    // gerencia & operador
    const result = await db.query(
        `SELECT f.id FROM factories f
     JOIN user_factory_access ufa ON f.id = ufa.factory_id
     WHERE ufa.user_id = $1 AND f.is_active = true`,
        [user.id]
    );
    return result.rows.map((r) => r.id);
};

module.exports = { tenantGuard, getUserFactoryIds };
