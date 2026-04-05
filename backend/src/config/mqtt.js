const mqtt = require('mqtt');
const config = require('./env');

let client = null;

const connect = () => {
    if (client) return client;

    const brokerUrl = `mqtt://${config.mqtt.host}:${config.mqtt.port}`;

    client = mqtt.connect(brokerUrl, {
        clientId: `fpsaver_backend_${Date.now()}`,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 30000,
        username: 'backend_service',
        password: process.env.MQTT_BACKEND_PASSWORD || 'backend_service_pass',
    });

    client.on('connect', () => {
        console.log('[MQTT] Connected to broker:', brokerUrl);
        // Subscribe to all factory telemetry topics
        client.subscribe('factory/+/telemetry', { qos: 1 }, (err) => {
            if (err) console.error('[MQTT] Subscribe error:', err);
            else console.log('[MQTT] Subscribed to factory/+/telemetry');
        });
        // Subscribe to factory status (heartbeat)
        client.subscribe('factory/+/status', { qos: 0 }, (err) => {
            if (err) console.error('[MQTT] Subscribe error:', err);
            else console.log('[MQTT] Subscribed to factory/+/status');
        });
    });

    client.on('error', (err) => {
        console.error('[MQTT] Connection error:', err);
    });

    client.on('reconnect', () => {
        console.log('[MQTT] Reconnecting...');
    });

    client.on('offline', () => {
        console.warn('[MQTT] Client offline');
    });

    return client;
};

/**
 * Publish a command to a factory's Raspberry Pi
 * @param {string} factoryId - Factory UUID
 * @param {object} command - Command payload
 */
const publishCommand = (factoryId, command) => {
    if (!client || !client.connected) {
        console.error('[MQTT] Cannot publish - not connected');
        return;
    }
    const topic = `factory/${factoryId}/commands`;
    client.publish(topic, JSON.stringify(command), { qos: 1 });
    console.log(`[MQTT] Published command to ${topic}:`, command);
};

const getClient = () => client;

module.exports = { connect, publishCommand, getClient };
