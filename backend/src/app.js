const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config/env');
const { apiLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const websocket = require('./config/websocket');
const mqttClient = require('./config/mqtt');
const mqttService = require('./services/mqtt.service');

// ============================================
// Express App
// ============================================
const app = express();
const server = http.createServer(app);

// ============================================
// Global Middleware
// ============================================
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api', apiLimiter);

// ============================================
// Routes
// ============================================
app.use('/api/health', require('./routes/health.routes'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/superadmin', require('./routes/superadmin.routes'));
app.use('/api/company', require('./routes/company.routes'));
app.use('/api/factories', require('./routes/factory.routes'));
app.use('/api/factories', require('./routes/production-line.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/telemetry', require('./routes/telemetry.routes'));
app.use('/api', require('./routes/contract.routes'));
app.use('/api/alarms', require('./routes/alarm.routes'));
app.use('/api/kpi', require('./routes/kpi.routes'));
app.use('/api/discovery', require('./routes/discovery.routes'));
app.use('/api', require('./routes/report.routes'));
app.use('/api', require('./routes/notification.routes'));
app.use('/api/chatbot', require('./routes/chatbot.routes'));

// 404 handler
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

// Error handler
app.use(errorHandler);

// ============================================
// WebSocket (Socket.io)
// ============================================
websocket.init(server);

// ============================================
// MQTT Connection & Message Handling
// ============================================
const discoveryService = require('./services/discovery.service');
const mqtt = mqttClient.connect();

// Subscribe to discovery and realtime topics
mqtt.on('connect', () => {
    mqtt.subscribe('factory/+/discovery', { qos: 1 });
    mqtt.subscribe('factory/+/realtime', { qos: 0 });
    console.log('[MQTT] Subscribed to factory/+/discovery, factory/+/realtime');
});

mqtt.on('message', (topic, payload) => {
    if (topic.includes('/realtime')) {
        mqttService.processRealtimeMessage(topic, payload);
    } else if (topic.includes('/telemetry')) {
        mqttService.processTelemetryMessage(topic, payload);
    } else if (topic.includes('/status')) {
        mqttService.processStatusMessage(topic, payload);
    } else if (topic.includes('/discovery')) {
        try {
            const data = JSON.parse(payload.toString());
            const factoryId = topic.split('/')[1];
            discoveryService.processDiscovery(factoryId, data);
        } catch (err) {
            console.error('[MQTT] Error processing discovery:', err.message);
        }
    }
});

// ============================================
// Start Server
// ============================================
const PORT = config.port;

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n  ❌ ERROR: Port ${PORT} is already in use!`);
        console.error(`  Another backend instance may already be running.`);
        console.error(`  Run: lsof -ti:${PORT} | xargs kill -9\n`);
        process.exit(1);
    } else {
        console.error('[Server] Unexpected error:', err);
        process.exit(1);
    }
});

server.listen(PORT, async () => {
    console.log(`
  ╔═══════════════════════════════════════════╗
  ║     FPSaver API Server                    ║
  ║     Port: ${PORT}                            ║
  ║     Env:  ${config.nodeEnv}                  ║
  ║     MQTT: ${config.mqtt.host}:${config.mqtt.port}              ║
  ║     PID:  ${process.pid}                          ║
  ╚═══════════════════════════════════════════╝
  `);

    // Start ESIOS price sync job
    try {
        const esiosSync = require('./jobs/esios-sync');
        await esiosSync.startSync();
    } catch (err) {
        console.error('[ESIOS-SYNC] Failed to start:', err.message);
    }

    // Start cost snapshot job (hourly historical records)
    try {
        const costSnapshot = require('./jobs/cost-snapshot');
        costSnapshot.startCostSnapshotJob();
    } catch (err) {
        console.error('[COST-SNAPSHOT] Failed to start:', err.message);
    }
});

// ============================================
// Graceful Shutdown
// ============================================
const gracefulShutdown = (signal) => {
    console.log(`\n[Server] ${signal} received — shutting down gracefully...`);

    server.close(() => {
        console.log('[Server] HTTP server closed.');

        // Close MQTT connection
        try { mqtt.end(true); } catch (e) { /* ignore */ }
        console.log('[Server] MQTT disconnected.');

        // Close DB pool
        try {
            const db = require('./config/database');
            db.pool.end();
        } catch (e) { /* ignore */ }
        console.log('[Server] Database pool closed.');

        console.log('[Server] ✓ Clean shutdown complete.');
        process.exit(0);
    });

    // Force exit after 5 seconds if graceful shutdown hangs
    setTimeout(() => {
        console.error('[Server] Forced exit after timeout.');
        process.exit(1);
    }, 5000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled errors
process.on('uncaughtException', (err) => {
    console.error('[Server] UNCAUGHT EXCEPTION:', err);
    gracefulShutdown('uncaughtException');
});

module.exports = { app, server };
