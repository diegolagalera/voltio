/**
 * FPSaver — Contract Controller
 * CRUD operations for electricity contracts + cost endpoints
 */

const db = require('../config/database');
const costService = require('../services/cost.service');
const esiosService = require('../services/esios.service');
const { getDaySchedule, PERIOD_COLORS, PERIOD_LABELS } = require('../utils/period-resolver');
const { getFactoryTimezone, getLocalDateStr, getLocalMidnight } = require('../utils/timezone');
const Joi = require('joi');

// ═══════════════════════════════════════════
// VALIDATION SCHEMAS
// ═══════════════════════════════════════════

const contractSchema = Joi.object({
    provider: Joi.string().max(255).required(),
    contract_number: Joi.string().max(100).allow('', null),
    tariff_type: Joi.string().valid('2.0TD', '3.0TD', '6.1TD', '6.2TD', '6.3TD', '6.4TD').required(),
    pricing_model: Joi.string().valid('fixed', 'indexed_omie', 'pvpc').required(),
    comercializadora: Joi.string().max(255).allow('', null),
    cups: Joi.string().max(22).allow('', null),
    start_date: Joi.date().required(),
    end_date: Joi.date().allow(null),
    // Contracted power per period (kW)
    power_p1_kw: Joi.number().min(0).allow(null),
    power_p2_kw: Joi.number().min(0).allow(null),
    power_p3_kw: Joi.number().min(0).allow(null),
    power_p4_kw: Joi.number().min(0).allow(null),
    power_p5_kw: Joi.number().min(0).allow(null),
    power_p6_kw: Joi.number().min(0).allow(null),
    // Energy prices (€/kWh, for fixed pricing)
    energy_price_p1: Joi.number().min(0).allow(null),
    energy_price_p2: Joi.number().min(0).allow(null),
    energy_price_p3: Joi.number().min(0).allow(null),
    energy_price_p4: Joi.number().min(0).allow(null),
    energy_price_p5: Joi.number().min(0).allow(null),
    energy_price_p6: Joi.number().min(0).allow(null),
    // Peajes (€/kWh)
    peaje_p1: Joi.number().min(0).allow(null),
    peaje_p2: Joi.number().min(0).allow(null),
    peaje_p3: Joi.number().min(0).allow(null),
    peaje_p4: Joi.number().min(0).allow(null),
    peaje_p5: Joi.number().min(0).allow(null),
    peaje_p6: Joi.number().min(0).allow(null),
    // Cargos (€/kWh)
    cargo_p1: Joi.number().min(0).allow(null),
    cargo_p2: Joi.number().min(0).allow(null),
    cargo_p3: Joi.number().min(0).allow(null),
    cargo_p4: Joi.number().min(0).allow(null),
    cargo_p5: Joi.number().min(0).allow(null),
    cargo_p6: Joi.number().min(0).allow(null),
    // Taxes
    electricity_tax: Joi.number().min(0).max(100).default(5.1127),
    iva: Joi.number().min(0).max(100).default(21.0),
    reactive_penalty_threshold: Joi.number().min(0).max(100).default(33.0),
    indexed_margin: Joi.number().min(0).default(0),
});

// ═══════════════════════════════════════════
// CONTRACT CRUD
// ═══════════════════════════════════════════

/**
 * GET /api/factories/:factoryId/contract
 */
const getContract = async (req, res) => {
    try {
        const { factoryId } = req.params;
        const result = await db.query(
            `SELECT c.*, f.name AS factory_name
             FROM contracts c
             JOIN factories f ON f.id = c.factory_id
             WHERE c.factory_id = $1 AND c.is_active = true
             ORDER BY c.created_at DESC LIMIT 1`,
            [factoryId]
        );

        if (!result.rows[0]) {
            return res.json({ data: null, message: 'No hay contrato configurado' });
        }

        res.json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Contract] Error getting contract:', err);
        res.status(500).json({ error: 'Error al obtener contrato' });
    }
};

/**
 * POST /api/factories/:factoryId/contract
 */
const createContract = async (req, res) => {
    try {
        const { factoryId } = req.params;
        const { error, value } = contractSchema.validate(req.body, { stripUnknown: true });
        if (error) return res.status(400).json({ error: error.details[0].message });

        // Get company_id from factory
        const factory = await db.query('SELECT company_id FROM factories WHERE id = $1', [factoryId]);
        if (!factory.rows[0]) return res.status(404).json({ error: 'Fábrica no encontrada' });

        // Deactivate existing contract
        await db.query(
            'UPDATE contracts SET is_active = false WHERE factory_id = $1 AND is_active = true',
            [factoryId]
        );

        // Create new contract
        const fields = Object.keys(value);
        const values = Object.values(value);
        const placeholders = values.map((_, i) => `$${i + 3}`);

        const result = await db.query(
            `INSERT INTO contracts (company_id, factory_id, ${fields.join(', ')})
             VALUES ($1, $2, ${placeholders.join(', ')})
             RETURNING *`,
            [factory.rows[0].company_id, factoryId, ...values]
        );

        res.status(201).json({ data: result.rows[0], message: 'Contrato creado exitosamente' });
    } catch (err) {
        console.error('[Contract] Error creating contract:', err);
        res.status(500).json({ error: 'Error al crear contrato' });
    }
};

/**
 * PUT /api/contracts/:id
 */
const updateContract = async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = contractSchema.validate(req.body, { stripUnknown: true });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const fields = Object.keys(value);
        const values = Object.values(value);
        const setClauses = fields.map((f, i) => `${f} = $${i + 2}`);

        const result = await db.query(
            `UPDATE contracts SET ${setClauses.join(', ')}, updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, ...values]
        );

        if (!result.rows[0]) return res.status(404).json({ error: 'Contrato no encontrado' });

        res.json({ data: result.rows[0], message: 'Contrato actualizado' });
    } catch (err) {
        console.error('[Contract] Error updating contract:', err);
        res.status(500).json({ error: 'Error al actualizar contrato' });
    }
};

// ═══════════════════════════════════════════
// COST ENDPOINTS
// ═══════════════════════════════════════════

/**
 * GET /api/factories/:factoryId/cost/current
 */
const getCurrentCost = async (req, res) => {
    try {
        const { factoryId } = req.params;
        const result = await costService.getCurrentCostPerKwh(factoryId);

        // F: Add accumulated cost today from cost_snapshots
        try {
            const tz = await getFactoryTimezone(factoryId);
            const today = getLocalDateStr(tz);
            const { toMidnightSQL, toNextDayMidnightSQL } = require('../utils/timezone');
            const dayStart = toMidnightSQL('$1', tz);
            const dayEnd = toNextDayMidnightSQL('$1', tz);

            const snapResult = await db.query(
                `SELECT
                    COALESCE(SUM(total_cost), 0) AS today_cost,
                    COALESCE(SUM(kwh), 0) AS today_kwh
                 FROM cost_snapshots
                 WHERE factory_id = $2
                   AND timestamp >= ${dayStart}
                   AND timestamp < ${dayEnd}`,
                [today, factoryId]
            );
            result.today_cost = parseFloat(snapResult.rows[0]?.today_cost || 0);
            result.today_kwh = parseFloat(snapResult.rows[0]?.today_kwh || 0);
        } catch (e) {
            // cost_snapshots may not exist or be empty — safe fallback
            result.today_cost = 0;
            result.today_kwh = 0;
        }

        res.json({ data: result });
    } catch (err) {
        console.error('[Cost] Error getting current cost:', err);
        res.status(500).json({ error: 'Error al calcular coste' });
    }
};

/**
 * GET /api/factories/:factoryId/cost/daily?date=YYYY-MM-DD
 */
const getDailyCost = async (req, res) => {
    try {
        const { factoryId } = req.params;
        const tz = await getFactoryTimezone(factoryId);
        const date = req.query.date || getLocalDateStr(tz);
        const result = await costService.getDailyCostBreakdown(factoryId, date);
        res.json({ data: result });
    } catch (err) {
        console.error('[Cost] Error getting daily cost:', err);
        res.status(500).json({ error: 'Error al calcular coste diario' });
    }
};

/**
 * GET /api/devices/:deviceId/cost?factoryId=...
 */
const getDeviceCost = async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { factoryId } = req.query;
        if (!factoryId) return res.status(400).json({ error: 'factoryId query parameter required' });

        const result = await costService.getDeviceCostEstimate(factoryId, deviceId);
        res.json({ data: result });
    } catch (err) {
        console.error('[Cost] Error getting device cost:', err);
        res.status(500).json({ error: 'Error al calcular coste del dispositivo' });
    }
};

// ═══════════════════════════════════════════
// ESIOS / PRICES ENDPOINTS
// ═══════════════════════════════════════════

/**
 * GET /api/esios/prices?date=YYYY-MM-DD&type=spot_omie
 */
const getEsiosPrices = async (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const type = req.query.type || 'spot_omie';
        const prices = await esiosService.getPrices(type, date, date);
        res.json({ data: prices });
    } catch (err) {
        console.error('[ESIOS] Error getting prices:', err);
        res.status(500).json({ error: 'Error al obtener precios' });
    }
};

/**
 * GET /api/factories/:factoryId/schedule?date=YYYY-MM-DD
 */
const getDayTariffSchedule = async (req, res) => {
    try {
        const { factoryId } = req.params;
        const tz = await getFactoryTimezone(factoryId);
        const date = req.query.date || getLocalDateStr(tz);

        const contract = await costService.getActiveContract(factoryId);
        const tariffType = contract?.tariff_type || '6.1TD';

        const dt = getLocalMidnight(date, tz);
        const schedule = await getDaySchedule(dt, tariffType);

        const result = schedule.map((period, h) => ({
            hour: h,
            period,
            label: PERIOD_LABELS[period],
            color: PERIOD_COLORS[period],
        }));

        res.json({ data: result, tariff_type: tariffType });
    } catch (err) {
        console.error('[Schedule] Error:', err);
        res.status(500).json({ error: 'Error al obtener horario' });
    }
};

// ═══════════════════════════════════════════
// HOLIDAYS CRUD
// ═══════════════════════════════════════════

/**
 * GET /api/holidays
 */
const getHolidays = async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM holidays ORDER BY date ASC'
        );
        res.json({ data: result.rows });
    } catch (err) {
        console.error('[Holidays] Error:', err);
        res.status(500).json({ error: 'Error al obtener festivos' });
    }
};

/**
 * POST /api/holidays
 */
const createHoliday = async (req, res) => {
    try {
        const { date, name, region } = req.body;
        if (!date || !name) return res.status(400).json({ error: 'Fecha y nombre son obligatorios' });

        const result = await db.query(
            `INSERT INTO holidays (date, name, region)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING
             RETURNING *`,
            [date, name, region || 'nacional']
        );

        if (!result.rows[0]) {
            return res.status(409).json({ error: 'Este festivo ya existe' });
        }

        res.status(201).json({ data: result.rows[0] });
    } catch (err) {
        console.error('[Holidays] Error creating:', err);
        res.status(500).json({ error: 'Error al crear festivo' });
    }
};

/**
 * DELETE /api/holidays/:id
 */
const deleteHoliday = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM holidays WHERE id = $1', [id]);
        res.json({ message: 'Festivo eliminado' });
    } catch (err) {
        console.error('[Holidays] Error deleting:', err);
        res.status(500).json({ error: 'Error al eliminar festivo' });
    }
};

module.exports = {
    getContract,
    createContract,
    updateContract,
    getCurrentCost,
    getDailyCost,
    getDeviceCost,
    getEsiosPrices,
    getDayTariffSchedule,
    getHolidays,
    createHoliday,
    deleteHoliday,
};
