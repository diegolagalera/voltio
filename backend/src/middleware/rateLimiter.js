const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

// General API rate limiter
// Industrial dashboards make many concurrent API calls (summary, charts, devices, etc.)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000,
    skip: () => isDev,        // completely bypass in development
    message: {
        success: false,
        message: 'Too many requests, please try again later',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Strict limiter for auth endpoints (brute-force protection)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    skip: () => isDev,        // completely bypass in development
    message: {
        success: false,
        message: 'Too many login attempts, please try again later',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Telemetry ingestion limiter (higher threshold for IoT)
const telemetryLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 120,
    skip: () => isDev,        // completely bypass in development
    message: {
        success: false,
        message: 'Telemetry rate limit exceeded',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = { apiLimiter, authLimiter, telemetryLimiter };
