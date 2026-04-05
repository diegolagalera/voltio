const db = require('../config/database');
const mqttClient = require('../config/mqtt');

/**
 * Process discovery messages received from RPi via MQTT.
 * Stores/updates discovered devices in the database.
 */
const processDiscovery = async (factoryId, discoveryPayload) => {
    const { devices = [] } = discoveryPayload;

    if (devices.length === 0) {
        console.log(`[Discovery] No devices found for factory ${factoryId.substring(0, 8)}`);
        return;
    }

    console.log(`[Discovery] Processing ${devices.length} discovered devices for factory ${factoryId.substring(0, 8)}`);

    for (const device of devices) {
        try {
            await db.query(
                `INSERT INTO discovered_devices (factory_id, ip_address, port, modbus_address, detected_model, detected_type, voltage_sample, discovered_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                 ON CONFLICT (factory_id, ip_address)
                 DO UPDATE SET
                     detected_model = EXCLUDED.detected_model,
                     detected_type = EXCLUDED.detected_type,
                     voltage_sample = EXCLUDED.voltage_sample,
                     discovered_at = NOW(),
                     status = CASE
                         WHEN discovered_devices.status = 'confirmed' THEN 'confirmed'
                         ELSE 'pending'
                     END`,
                [
                    factoryId,
                    device.ip_address,
                    device.port || 502,
                    device.modbus_address || 1,
                    device.detected_model,
                    device.detected_type,
                    device.voltage_sample || null,
                ]
            );
        } catch (err) {
            console.error(`[Discovery] Error storing device ${device.ip_address}:`, err.message);
        }
    }

    console.log(`[Discovery] Stored ${devices.length} discoveries for factory ${factoryId.substring(0, 8)}`);
};

/**
 * Get all discovered devices for a factory.
 */
const getDiscoveries = async (factoryId, status = null) => {
    let query = `
        SELECT dd.*, d.name as confirmed_device_name
        FROM discovered_devices dd
        LEFT JOIN devices d ON dd.device_id = d.id
        WHERE dd.factory_id = $1`;
    const params = [factoryId];

    if (status) {
        query += ` AND dd.status = $2`;
        params.push(status);
    }

    query += ` ORDER BY dd.discovered_at DESC`;

    const result = await db.query(query, params);
    return result.rows;
};

/**
 * Confirm a discovered device: create it in the devices table and send add_device MQTT command.
 */
const confirmDevice = async (discoveryId, factoryId, userId, deviceData) => {
    const { name, device_type } = deviceData;

    // Get discovery record
    const disc = await db.query(
        'SELECT * FROM discovered_devices WHERE id = $1 AND factory_id = $2',
        [discoveryId, factoryId]
    );

    if (disc.rows.length === 0) {
        throw new Error('Discovery not found');
    }

    const discovery = disc.rows[0];

    if (discovery.status === 'confirmed') {
        throw new Error('Device already confirmed');
    }

    // Create the device in the devices table
    const deviceResult = await db.query(
        `INSERT INTO devices (factory_id, name, device_type, host, port, modbus_address, model, serial_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
            factoryId,
            name,
            device_type || discovery.detected_type,
            discovery.ip_address,
            discovery.port,
            discovery.modbus_address,
            discovery.detected_model,
            `USR-${discovery.ip_address.split('.').pop()}`,  // e.g., USR-11
        ]
    );

    const newDevice = deviceResult.rows[0];

    // Update discovery status
    await db.query(
        `UPDATE discovered_devices SET status = 'confirmed', confirmed_at = NOW(), confirmed_by = $1, device_id = $2 WHERE id = $3`,
        [userId, newDevice.id, discoveryId]
    );

    // Audit log
    await db.query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_values)
         VALUES ($1, 'confirm_device', 'device', $2, $3)`,
        [userId, newDevice.id, JSON.stringify({ name, ip: discovery.ip_address })]
    );

    // Send MQTT command to RPi to start reading this device
    // Include detected_model so gateway can select correct register map
    // (device_type is the DB schema type e.g. 'trifasica', but the gateway
    //  needs the internal type e.g. 'sdm630mct' for correct Modbus protocol)
    mqttClient.publishCommand(factoryId, {
        action: 'add_device',
        device: {
            device_id: newDevice.id,
            name: newDevice.name,
            device_type: newDevice.device_type,      // DB type: trifasica/monofasica
            detected_type: discovery.detected_type,   // Same as device_type
            model: newDevice.model,                   // e.g., SDM630MCT-V2
            host: newDevice.host,
            port: newDevice.port,
            modbus_address: newDevice.modbus_address,
        },
    });

    console.log(`[Discovery] Device confirmed: ${name} (${discovery.ip_address}) → ID ${newDevice.id}`);

    return newDevice;
};

/**
 * Ignore a discovered device.
 */
const ignoreDevice = async (discoveryId, factoryId) => {
    const result = await db.query(
        `UPDATE discovered_devices SET status = 'ignored' WHERE id = $1 AND factory_id = $2 RETURNING *`,
        [discoveryId, factoryId]
    );

    if (result.rows.length === 0) {
        throw new Error('Discovery not found');
    }

    return result.rows[0];
};

/**
 * Trigger an on-demand network scan via MQTT command.
 */
const triggerScan = (factoryId, scanRange = null) => {
    const command = { action: 'scan_network' };
    if (scanRange) {
        command.scan_range = scanRange;
    }
    mqttClient.publishCommand(factoryId, command);
    console.log(`[Discovery] Scan triggered for factory ${factoryId.substring(0, 8)}`);
};

module.exports = {
    processDiscovery,
    getDiscoveries,
    confirmDevice,
    ignoreDevice,
    triggerScan,
};
