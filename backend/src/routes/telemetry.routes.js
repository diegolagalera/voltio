const router = require('express').Router();
const ctrl = require('../controllers/telemetry.controller');
const auth = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { telemetryLimiter } = require('../middleware/rateLimiter');
const { validate, telemetryBatchSchema, historyQuerySchema } = require('../utils/validators');

// Ingest endpoint — uses API key (no JWT needed for RPi)
router.post('/ingest', telemetryLimiter, validate(telemetryBatchSchema), ctrl.ingest);

// Query endpoints — require auth + tenant check
router.get('/:deviceId/latest', auth, ctrl.getLatest);
router.get('/:deviceId/history', auth, validate(historyQuerySchema, 'query'), ctrl.getHistory);
router.get('/factory/:factoryId/summary', auth, tenantGuard, ctrl.getFactorySummary);

module.exports = router;
