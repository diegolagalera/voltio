/**
 * FPSaver — Contract, Cost & ESIOS Routes
 */

const router = require('express').Router();
const ctrl = require('../controllers/contract.controller');
const auth = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// ── Contract CRUD ──
router.get('/factories/:factoryId/contract', ctrl.getContract);
router.post('/factories/:factoryId/contract', ctrl.createContract);
router.put('/contracts/:id', ctrl.updateContract);

// ── Cost endpoints ──
router.get('/factories/:factoryId/cost/current', ctrl.getCurrentCost);
router.get('/factories/:factoryId/cost/daily', ctrl.getDailyCost);
router.get('/devices/:deviceId/cost', ctrl.getDeviceCost);

// ── ESIOS Prices & Schedule ──
router.get('/esios/prices', ctrl.getEsiosPrices);
router.get('/factories/:factoryId/schedule', ctrl.getDayTariffSchedule);

// ── Holidays CRUD ──
router.get('/holidays', ctrl.getHolidays);
router.post('/holidays', ctrl.createHoliday);
router.delete('/holidays/:id', ctrl.deleteHoliday);

// ── Factory Update (comunidad_autonoma, etc.) ──
router.patch('/factories/:factoryId', async (req, res) => {
    try {
        const { factoryId } = req.params;
        const { comunidad_autonoma } = req.body;
        if (!comunidad_autonoma) return res.status(400).json({ error: 'comunidad_autonoma required' });

        const db = require('../config/database');
        await db.query(
            'UPDATE factories SET comunidad_autonoma = $1 WHERE id = $2',
            [comunidad_autonoma, factoryId]
        );
        res.json({ message: 'Fábrica actualizada' });
    } catch (err) {
        console.error('[Factory] Patch error:', err);
        res.status(500).json({ error: 'Error al actualizar' });
    }
});

module.exports = router;
