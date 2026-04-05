const db = require('../config/database');
const { hash } = require('../utils/password');

/**
 * GET /api/users
 * List users in the manager's company
 */
const listUsers = async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.phone, u.is_active, u.last_login, u.created_at,
        COALESCE(
          json_agg(
            json_build_object('id', f.id, 'name', f.name)
          ) FILTER (WHERE f.id IS NOT NULL),
          '[]'
        ) as factories
       FROM users u
       LEFT JOIN user_factory_access ufa ON u.id = ufa.user_id
       LEFT JOIN factories f ON ufa.factory_id = f.id
       WHERE u.company_id = $1 AND u.role != 'superadmin'
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
            [req.user.companyId]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/users
 * Create a new user (gerencia or operador)
 */
const createUser = async (req, res, next) => {
    try {
        const { email, password, first_name, last_name, role, phone, factory_ids } = req.body;

        // Managers can only create gerencia and operador
        if (role === 'manager' || role === 'superadmin') {
            return res.status(403).json({ success: false, message: 'Cannot create users with this role' });
        }

        const passwordHash = await hash(password);

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const result = await client.query(
                `INSERT INTO users (company_id, email, password_hash, first_name, last_name, role, phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, first_name, last_name, role`,
                [req.user.companyId, email.toLowerCase(), passwordHash, first_name, last_name, role, phone]
            );

            const userId = result.rows[0].id;

            // Assign factory access
            if (factory_ids && factory_ids.length > 0) {
                for (const factoryId of factory_ids) {
                    // Verify factory belongs to this company
                    const fCheck = await client.query(
                        'SELECT id FROM factories WHERE id = $1 AND company_id = $2',
                        [factoryId, req.user.companyId]
                    );
                    if (fCheck.rows.length > 0) {
                        await client.query(
                            'INSERT INTO user_factory_access (user_id, factory_id, granted_by) VALUES ($1, $2, $3)',
                            [userId, factoryId, req.user.id]
                        );
                    }
                }
            }

            await client.query('COMMIT');

            res.status(201).json({ success: true, data: result.rows[0] });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        next(err);
    }
};

/**
 * PUT /api/users/:id
 */
const updateUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { first_name, last_name, phone, is_active } = req.body;

        // Verify user belongs to same company
        const userCheck = await db.query(
            'SELECT id FROM users WHERE id = $1 AND company_id = $2',
            [id, req.user.companyId]
        );
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const result = await db.query(
            `UPDATE users SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        phone = COALESCE($3, phone),
        is_active = COALESCE($4, is_active)
       WHERE id = $5 AND company_id = $6
       RETURNING id, email, first_name, last_name, role, phone, is_active`,
            [first_name, last_name, phone, is_active, id, req.user.companyId]
        );

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        next(err);
    }
};

/**
 * PUT /api/users/:id/access
 * Update factory access for a user
 */
const updateUserAccess = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { factory_ids } = req.body;

        // Verify user belongs to same company
        const userCheck = await db.query(
            'SELECT id, role FROM users WHERE id = $1 AND company_id = $2',
            [id, req.user.companyId]
        );
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            // Remove existing access
            await client.query('DELETE FROM user_factory_access WHERE user_id = $1', [id]);

            // Add new access
            for (const factoryId of factory_ids) {
                const fCheck = await client.query(
                    'SELECT id FROM factories WHERE id = $1 AND company_id = $2',
                    [factoryId, req.user.companyId]
                );
                if (fCheck.rows.length > 0) {
                    await client.query(
                        'INSERT INTO user_factory_access (user_id, factory_id, granted_by) VALUES ($1, $2, $3)',
                        [id, factoryId, req.user.id]
                    );
                }
            }

            await client.query('COMMIT');

            res.json({ success: true, message: 'Factory access updated' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        next(err);
    }
};

/**
 * DELETE /api/users/:id (soft delete)
 */
const deactivateUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        await db.query(
            'UPDATE users SET is_active = false WHERE id = $1 AND company_id = $2',
            [id, req.user.companyId]
        );
        res.json({ success: true, message: 'User deactivated' });
    } catch (err) {
        next(err);
    }
};

module.exports = { listUsers, createUser, updateUser, updateUserAccess, deactivateUser };
