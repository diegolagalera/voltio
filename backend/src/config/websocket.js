const { Server } = require('socket.io');
const mqttClient = require('./mqtt');

let io = null;

// Track active rooms to know when to start/stop real-time streaming
const activeRooms = new Map(); // factoryId -> Set of socket IDs

/**
 * Initialize Socket.io server
 * @param {import('http').Server} httpServer
 */
const init = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: process.env.VITE_API_URL ? process.env.VITE_API_URL.replace('/api', '') : '*',
            methods: ['GET', 'POST'],
        },
        transports: ['websocket', 'polling'],
    });

    io.on('connection', (socket) => {
        console.log(`[WS] Client connected: ${socket.id}`);

        // Client joins a factory room for real-time data
        socket.on('join:factory', (factoryId) => {
            const room = `factory:${factoryId}`;
            socket.join(room);

            // Track this socket in the active rooms
            if (!activeRooms.has(factoryId)) {
                activeRooms.set(factoryId, new Set());
                // First client for this factory → tell RPi to start real-time
                mqttClient.publishCommand(factoryId, { action: 'start_realtime' });
                console.log(`[WS] Real-time ACTIVATED for factory ${factoryId}`);
            }
            activeRooms.get(factoryId).add(socket.id);

            console.log(`[WS] ${socket.id} joined room ${room} (${activeRooms.get(factoryId).size} clients)`);
        });

        // Client leaves a factory room
        socket.on('leave:factory', (factoryId) => {
            handleLeaveFactory(socket, factoryId);
        });

        socket.on('disconnect', () => {
            console.log(`[WS] Client disconnected: ${socket.id}`);
            // Clean up all rooms this socket was in
            for (const [factoryId, sockets] of activeRooms.entries()) {
                if (sockets.has(socket.id)) {
                    handleLeaveFactory(socket, factoryId);
                }
            }
        });
    });

    console.log('[WS] Socket.io initialized');
    return io;
};

/**
 * Handle a socket leaving a factory room
 */
const handleLeaveFactory = (socket, factoryId) => {
    const room = `factory:${factoryId}`;
    socket.leave(room);

    if (activeRooms.has(factoryId)) {
        activeRooms.get(factoryId).delete(socket.id);
        const remaining = activeRooms.get(factoryId).size;

        if (remaining === 0) {
            activeRooms.delete(factoryId);
            // No more clients → tell RPi to stop real-time
            mqttClient.publishCommand(factoryId, { action: 'stop_realtime' });
            console.log(`[WS] Real-time DEACTIVATED for factory ${factoryId}`);
        }

        console.log(`[WS] ${socket.id} left room ${room} (${remaining} clients remaining)`);
    }
};

/**
 * Emit telemetry data to a factory room
 * @param {string} factoryId
 * @param {object} data
 */
const emitTelemetry = (factoryId, data) => {
    if (!io) return;
    io.to(`factory:${factoryId}`).emit('telemetry:realtime', data);
};

/**
 * Emit alarm to a factory room
 * @param {string} factoryId
 * @param {object} alarm
 */
const emitAlarm = (factoryId, alarm) => {
    if (!io) return;
    io.to(`factory:${factoryId}`).emit('alarm:new', alarm);
};

/**
 * Emit system notification to a factory room
 * @param {string} factoryId
 * @param {object} payload - { type: 'new'|'updated'|'resolved', notification }
 */
const emitNotification = (factoryId, payload) => {
    if (!io) return;
    io.to(`factory:${factoryId}`).emit('notification:update', payload);
};

/**
 * Check if a factory has active real-time listeners
 * @param {string} factoryId
 * @returns {boolean}
 */
const hasActiveListeners = (factoryId) => {
    return activeRooms.has(factoryId) && activeRooms.get(factoryId).size > 0;
};

const getIO = () => io;

module.exports = { init, emitTelemetry, emitAlarm, emitNotification, hasActiveListeners, getIO };
