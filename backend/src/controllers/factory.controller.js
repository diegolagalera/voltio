const db = require('../config/database');
const mqttCreds = require('../services/mqtt-credentials.service');

/**
 * GET /api/factories/:factoryId
 */
const getFactory = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const result = await db.query(
            `SELECT f.*, c.name as company_name,
        (SELECT COUNT(*) FROM devices d WHERE d.factory_id = f.id AND d.is_active = true) as device_count
       FROM factories f
       JOIN companies c ON f.company_id = c.id
       WHERE f.id = $1`,
            [factoryId]
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
 * GET /api/factories/:factoryId/devices
 */
const listDevices = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const includeInactive = req.query.include_inactive === 'true';

        const activeFilter = includeInactive ? '' : 'AND d.is_active = true';

        const result = await db.query(
            `SELECT d.*,
        tr.data as latest_data,
        tr.last_updated as latest_timestamp,
        pd.name as parent_name,
        CASE
            WHEN tr.last_updated IS NOT NULL
                 AND tr.last_updated > NOW() - INTERVAL '10 minutes'
            THEN true ELSE false
        END as is_online
       FROM devices d
       LEFT JOIN telemetry_realtime tr ON d.id = tr.device_id
       LEFT JOIN devices pd ON d.parent_device_id = pd.id
       WHERE d.factory_id = $1 ${activeFilter}
       ORDER BY COALESCE(d.parent_device_id, d.id), d.parent_device_id NULLS FIRST, d.name`,
            [factoryId]
        );

        // Null out stale data so frontend shows "sin datos" for offline devices
        const devices = result.rows.map(d => ({
            ...d,
            latest_data: d.is_online ? d.latest_data : null,
            latest_timestamp: d.is_online ? d.latest_timestamp : d.latest_timestamp,
        }));

        res.json({ success: true, data: devices });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/factories/:factoryId/devices
 */
const createDevice = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const { name, serial_number, device_type, modbus_address, model, description, metadata, host, port } = req.body;

        const result = await db.query(
            `INSERT INTO devices (factory_id, name, serial_number, device_type, modbus_address, model, description, metadata, host, port)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [factoryId, name, serial_number, device_type, modbus_address, model, description, JSON.stringify(metadata || {}), host || null, port || 502]
        );

        await db.query(
            `INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_values)
       VALUES ($1, 'create', 'device', $2, $3)`,
            [req.user.id, result.rows[0].id, JSON.stringify(req.body)]
        );

        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        next(err);
    }
};

/**
 * PUT /api/factories/:factoryId/devices/:deviceId
 */
const updateDevice = async (req, res, next) => {
    try {
        const { factoryId, deviceId } = req.params;
        const {
            name, serial_number, device_type, modbus_address, model,
            description, metadata, is_active,
            device_role, parent_device_id, parent_relation, phase_channel
        } = req.body;

        // If setting as general_meter, clear any previous general_meter in this factory
        if (device_role === 'general_meter') {
            await db.query(
                `UPDATE devices SET device_role = 'sub_meter'
                 WHERE factory_id = $1 AND device_role = 'general_meter' AND id != $2`,
                [factoryId, deviceId]
            );
        }

        // Fetch current hierarchy BEFORE update (for logging changes)
        const oldDevice = await db.query(
            'SELECT parent_device_id, parent_relation, phase_channel FROM devices WHERE id = $1',
            [deviceId]
        );
        const old = oldDevice.rows[0] || {};

        const result = await db.query(
            `UPDATE devices SET
        name = COALESCE($1, name),
        serial_number = COALESCE($2, serial_number),
        device_type = COALESCE($3, device_type),
        modbus_address = COALESCE($4, modbus_address),
        model = COALESCE($5, model),
        description = COALESCE($6, description),
        metadata = COALESCE($7, metadata),
        is_active = COALESCE($8, is_active),
        device_role = COALESCE($9, device_role),
        parent_device_id = $10,
        parent_relation = $11,
        phase_channel = $12
       WHERE id = $13 AND factory_id = $14 RETURNING *`,
            [
                name, serial_number, device_type, modbus_address, model, description,
                metadata ? JSON.stringify(metadata) : null, is_active,
                device_role, parent_device_id || null, parent_relation || null,
                phase_channel || null, deviceId, factoryId
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Device not found' });
        }

        // Log hierarchy change if parent/relation/phase changed
        const newParent = parent_device_id || null;
        const newRelation = parent_relation || null;
        const newPhase = phase_channel || null;
        const hierarchyChanged = old.parent_device_id !== newParent
            || old.parent_relation !== newRelation
            || old.phase_channel !== newPhase;

        if (hierarchyChanged) {
            // Log detach from old parent (if had one)
            if (old.parent_device_id) {
                await db.query(
                    `INSERT INTO device_hierarchy_log (device_id, parent_device_id, parent_relation, phase_channel, action)
                     VALUES ($1, $2, $3, $4, 'detached')`,
                    [deviceId, old.parent_device_id, old.parent_relation, old.phase_channel]
                );
            }
            // Log attach to new parent (if has one)
            if (newParent) {
                await db.query(
                    `INSERT INTO device_hierarchy_log (device_id, parent_device_id, parent_relation, phase_channel, action)
                     VALUES ($1, $2, $3, $4, 'attached')`,
                    [deviceId, newParent, newRelation, newPhase]
                );
            }
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/factories/:factoryId/devices/:deviceId/phase-children
 * Creates L1/L2/L3 sub-devices for a trifásico meter
 * Body: { phases: { L1: "CNC Fresadora", L2: "Prensa Hidráulica", L3: "Horno Industrial" } }
 */
const createPhaseChildren = async (req, res, next) => {
    try {
        const { factoryId, deviceId } = req.params;
        const { phases } = req.body;

        if (!phases || typeof phases !== 'object') {
            return res.status(400).json({ success: false, message: 'phases object required (L1, L2, L3)' });
        }

        // Verify parent device exists and is trifásica
        const parent = await db.query(
            'SELECT id, device_type FROM devices WHERE id = $1 AND factory_id = $2',
            [deviceId, factoryId]
        );
        if (!parent.rows.length) {
            return res.status(404).json({ success: false, message: 'Parent device not found' });
        }

        // Log detach for existing phase children before deleting them
        const existingChildren = await db.query(
            `SELECT id, phase_channel FROM devices WHERE parent_device_id = $1 AND parent_relation = 'phase_channel'`,
            [deviceId]
        );
        for (const child of existingChildren.rows) {
            await db.query(
                `INSERT INTO device_hierarchy_log (device_id, parent_device_id, parent_relation, phase_channel, action)
                 VALUES ($1, $2, 'phase_channel', $3, 'detached')`,
                [child.id, deviceId, child.phase_channel]
            );
        }

        // Delete existing phase children for this parent
        await db.query(
            `DELETE FROM devices WHERE parent_device_id = $1 AND parent_relation = 'phase_channel'`,
            [deviceId]
        );

        const created = [];
        for (const [phase, name] of Object.entries(phases)) {
            if (!['L1', 'L2', 'L3'].includes(phase) || !name) continue;
            const result = await db.query(
                `INSERT INTO devices (factory_id, name, device_type, modbus_address, model, device_role, parent_device_id, parent_relation, phase_channel)
                 VALUES ($1, $2, 'monofasica', NULL, 'Virtual', 'sub_meter', $3, 'phase_channel', $4) RETURNING *`,
                [factoryId, name, deviceId, phase]
            );
            created.push(result.rows[0]);
            // Log attach for new phase child
            await db.query(
                `INSERT INTO device_hierarchy_log (device_id, parent_device_id, parent_relation, phase_channel, action)
                 VALUES ($1, $2, 'phase_channel', $3, 'attached')`,
                [result.rows[0].id, deviceId, phase]
            );
        }

        res.status(201).json({ success: true, data: created });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/factories/:factoryId/mqtt-credentials
 */
const getMqttCredentials = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const creds = await mqttCreds.getCredentials(factoryId);

        res.json({
            success: true,
            data: {
                ...creds,
                broker_host: process.env.MQTT_PUBLIC_HOST || 'YOUR_SERVER_IP',
                broker_port_tls: 8883,
                broker_port_plain: 1883,
            },
        });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/factories/:factoryId/mqtt-credentials/regenerate
 */
const regenerateMqttCredentials = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const creds = await mqttCreds.regenerateCredentials(factoryId);

        await db.query(
            `INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_values)
       VALUES ($1, 'regenerate_mqtt_credentials', 'factory', $2, $3)`,
            [req.user.id, factoryId, JSON.stringify({ username: creds.username })]
        );

        res.json({
            success: true,
            data: {
                ...creds,
                broker_host: process.env.MQTT_PUBLIC_HOST || 'YOUR_SERVER_IP',
                broker_port_tls: 8883,
                broker_port_plain: 1883,
            },
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/factories/:factoryId/download-config
 */
const downloadConfig = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const creds = await mqttCreds.getCredentials(factoryId);

        const devicesResult = await db.query(
            'SELECT id, name, device_type, host, port, modbus_address, model FROM devices WHERE factory_id = $1 AND is_active = true ORDER BY name',
            [factoryId]
        );

        const config = {
            factory_id: factoryId,
            mqtt: {
                broker_host: process.env.MQTT_PUBLIC_HOST || 'YOUR_SERVER_IP',
                broker_port: 8883,
                username: creds.username,
                password: creds.password,
                client_id_prefix: 'rpi_factory',
                tls: { enabled: true, ca_cert: './certs/ca.crt' },
            },
            network: {
                scan_range_start: '192.168.10.10',
                scan_range_end: '192.168.10.50',
                scan_port: 502,
                scan_on_boot: true,
            },
            devices: devicesResult.rows.map(d => ({
                device_id: d.id,
                name: d.name,
                device_type: d.device_type,
                model: d.model || (d.device_type === 'trifasica' ? 'EM340' : 'EM111'),
                host: d.host || '192.168.10.11',
                port: d.port || 502,
                modbus_address: d.modbus_address || 1,
            })),
            intervals: { batch_seconds: 300, realtime_seconds: 5, scan_interval_hours: 24 },
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="config.json"');
        res.json(config);
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/factories/:factoryId/graph-positions
 * Returns saved node positions for the graph view
 */
const getGraphPositions = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const result = await db.query(
            'SELECT node_id, pos_x, pos_y FROM graph_node_positions WHERE factory_id = $1',
            [factoryId]
        );

        const positions = {};
        for (const row of result.rows) {
            positions[row.node_id] = { x: row.pos_x, y: row.pos_y };
        }

        res.json({ success: true, data: positions });
    } catch (err) {
        next(err);
    }
};

/**
 * PUT /api/factories/:factoryId/graph-positions
 * Body: { positions: { "node-uuid": { x: 100, y: 200 }, ... } }
 * Bulk-upserts all node positions in one transaction
 */
const saveGraphPositions = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        const { positions } = req.body;

        if (!positions || typeof positions !== 'object') {
            return res.status(400).json({ success: false, message: 'positions object required' });
        }

        const entries = Object.entries(positions);
        if (!entries.length) {
            return res.json({ success: true, data: {} });
        }

        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            for (const [nodeId, pos] of entries) {
                await client.query(
                    `INSERT INTO graph_node_positions (factory_id, node_id, pos_x, pos_y, updated_at)
                     VALUES ($1, $2, $3, $4, NOW())
                     ON CONFLICT (factory_id, node_id)
                     DO UPDATE SET pos_x = $3, pos_y = $4, updated_at = NOW()`,
                    [factoryId, nodeId, pos.x, pos.y]
                );
            }
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

        res.json({ success: true, data: positions });
    } catch (err) {
        next(err);
    }
};

/**
 * DELETE /api/factories/:factoryId/graph-positions
 * Resets all saved positions for a factory (returns to algorithmic layout)
 */
const resetGraphPositions = async (req, res, next) => {
    try {
        const { factoryId } = req.params;
        await db.query('DELETE FROM graph_node_positions WHERE factory_id = $1', [factoryId]);
        res.json({ success: true, message: 'Positions reset' });
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getFactory, listDevices, createDevice, updateDevice, createPhaseChildren,
    getMqttCredentials, regenerateMqttCredentials, downloadConfig,
    getGraphPositions, saveGraphPositions, resetGraphPositions,
};
