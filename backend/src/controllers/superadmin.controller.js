const db = require('../config/database');
const { hash } = require('../utils/password');

/**
 * GET /api/superadmin/companies
 */
const listCompanies = async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT c.*, 
        (SELECT COUNT(*) FROM factories f WHERE f.company_id = c.id) as factory_count,
        (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) as user_count
       FROM companies c
       ORDER BY c.created_at DESC`
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/superadmin/companies
 * Atomically creates company + optional first manager
 */
const createCompany = async (req, res, next) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { name, tax_id, address, city, phone, contact_email, country, timezone, manager } = req.body;

        const companyResult = await client.query(
            `INSERT INTO companies (name, tax_id, address, city, phone, contact_email, country, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [name, tax_id, address, city, phone, contact_email, country, timezone]
        );
        const company = companyResult.rows[0];

        // Create manager if provided
        let managerUser = null;
        if (manager) {
            const passwordHash = await hash(manager.password);
            const managerResult = await client.query(
                `INSERT INTO users (company_id, email, password_hash, first_name, last_name, role)
           VALUES ($1, $2, $3, $4, $5, 'manager') RETURNING id, email, first_name, last_name, role`,
                [company.id, manager.email.toLowerCase(), passwordHash, manager.first_name, manager.last_name]
            );
            managerUser = managerResult.rows[0];
        }

        // Audit log
        await client.query(
            `INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_values)
       VALUES ($1, 'create', 'company', $2, $3)`,
            [req.user.id, company.id, JSON.stringify({ ...req.body, manager: manager ? { email: manager.email } : null })]
        );

        await client.query('COMMIT');
        res.status(201).json({ success: true, data: { ...company, manager: managerUser } });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
};

/**
 * PUT /api/superadmin/companies/:id
 */
const updateCompany = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, tax_id, address, city, phone, contact_email, country, timezone, is_active } = req.body;

        const result = await db.query(
            `UPDATE companies SET
        name = COALESCE($1, name),
        tax_id = COALESCE($2, tax_id),
        address = COALESCE($3, address),
        city = COALESCE($4, city),
        phone = COALESCE($5, phone),
        contact_email = COALESCE($6, contact_email),
        country = COALESCE($7, country),
        timezone = COALESCE($8, timezone),
        is_active = COALESCE($9, is_active)
       WHERE id = $10 RETURNING *`,
            [name, tax_id, address, city, phone, contact_email, country, timezone, is_active, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        next(err);
    }
};

/**
 * DELETE /api/superadmin/companies/:id (soft delete)
 */
const deactivateCompany = async (req, res, next) => {
    try {
        const { id } = req.params;
        await db.query('UPDATE companies SET is_active = false WHERE id = $1', [id]);
        // Also deactivate all users & factories
        await db.query('UPDATE users SET is_active = false WHERE company_id = $1', [id]);
        await db.query('UPDATE factories SET is_active = false WHERE company_id = $1', [id]);

        res.json({ success: true, message: 'Company deactivated' });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/superadmin/companies/:companyId/factories
 */
const createFactory = async (req, res, next) => {
    try {
        const { companyId } = req.params;
        const { name, location_address, city, latitude, longitude, timezone } = req.body;

        // Verify company exists
        const companyCheck = await db.query('SELECT id FROM companies WHERE id = $1', [companyId]);
        if (companyCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        // Generate MQTT topic based on factory UUID
        const result = await db.query(
            `INSERT INTO factories (company_id, name, location_address, city, latitude, longitude, timezone, mqtt_topic)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [companyId, name, location_address, city, latitude, longitude, timezone, null]
        );

        // Set mqtt_topic using the generated UUID
        const factoryId = result.rows[0].id;
        await db.query(
            'UPDATE factories SET mqtt_topic = $1 WHERE id = $2',
            [`factory/${factoryId}`, factoryId]
        );
        result.rows[0].mqtt_topic = `factory/${factoryId}`;

        // Audit log
        await db.query(
            `INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_values)
       VALUES ($1, 'create', 'factory', $2, $3)`,
            [req.user.id, factoryId, JSON.stringify(req.body)]
        );

        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        next(err);
    }
};

/**
 * PUT /api/superadmin/factories/:id
 */
const updateFactory = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, location_address, city, latitude, longitude, timezone } = req.body;

        const result = await db.query(
            `UPDATE factories SET
        name = COALESCE($1, name),
        location_address = COALESCE($2, location_address),
        city = COALESCE($3, city),
        latitude = COALESCE($4, latitude),
        longitude = COALESCE($5, longitude),
        timezone = COALESCE($6, timezone)
       WHERE id = $7 RETURNING *`,
            [name, location_address, city, latitude, longitude, timezone, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Factory not found' });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/superadmin/companies/:companyId/manager
 * Create the first Manager user for a company
 */
const createManager = async (req, res, next) => {
    try {
        const { companyId } = req.params;
        const { email, password, first_name, last_name, phone } = req.body;

        // Verify company exists
        const companyCheck = await db.query('SELECT id FROM companies WHERE id = $1', [companyId]);
        if (companyCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        const passwordHash = await hash(password);
        const result = await db.query(
            `INSERT INTO users (company_id, email, password_hash, first_name, last_name, role, phone)
       VALUES ($1, $2, $3, $4, $5, 'manager', $6) RETURNING id, email, first_name, last_name, role`,
            [companyId, email.toLowerCase(), passwordHash, first_name, last_name, phone]
        );

        // Audit log
        await db.query(
            `INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_values)
       VALUES ($1, 'create', 'user', $2, $3)`,
            [req.user.id, result.rows[0].id, JSON.stringify({ email, role: 'manager', companyId })]
        );

        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/superadmin/stats
 */
const getStats = async (req, res, next) => {
    try {
        const stats = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM companies WHERE is_active = true) as total_companies,
        (SELECT COUNT(*) FROM factories WHERE is_active = true) as total_factories,
        (SELECT COUNT(*) FROM devices WHERE is_active = true) as total_devices,
        (SELECT COUNT(*) FROM users WHERE is_active = true AND role != 'superadmin') as total_users,
        (SELECT COUNT(*) FROM alarms WHERE acknowledged = false) as active_alarms
    `);

        res.json({ success: true, data: stats.rows[0] });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/superadmin/factories
 * SuperAdmin can list ALL factories across all companies
 */
const listAllFactories = async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT f.*, c.name as company_name,
        (SELECT COUNT(*) FROM devices d WHERE d.factory_id = f.id) as device_count
       FROM factories f
       JOIN companies c ON f.company_id = c.id
       ORDER BY c.name, f.name`
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        next(err);
    }
};

module.exports = {
    listCompanies, createCompany, updateCompany, deactivateCompany,
    createFactory, updateFactory,
    createManager,
    getStats,
    listAllFactories,
};
