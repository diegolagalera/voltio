const Joi = require('joi');

// ============================================
// Auth Schemas
// ============================================
const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
});

const refreshSchema = Joi.object({
    refreshToken: Joi.string().required(),
});

// ============================================
// Company Schemas
// ============================================
const createCompanySchema = Joi.object({
    name: Joi.string().min(2).max(255).required(),
    tax_id: Joi.string().max(50).allow('', null),
    address: Joi.string().allow('', null),
    city: Joi.string().max(100).allow('', null),
    phone: Joi.string().max(20).allow('', null),
    contact_email: Joi.string().email().allow('', null),
    country: Joi.string().max(100).default('España'),
    timezone: Joi.string().max(50).default('Europe/Madrid'),
    manager: Joi.object({
        first_name: Joi.string().min(1).max(100).required(),
        last_name: Joi.string().min(1).max(100).required(),
        email: Joi.string().email().required(),
        password: Joi.string().min(8).required(),
    }).allow(null),
});

const updateCompanySchema = Joi.object({
    name: Joi.string().min(2).max(255),
    tax_id: Joi.string().max(50).allow('', null),
    address: Joi.string().allow('', null),
    city: Joi.string().max(100).allow('', null),
    phone: Joi.string().max(20).allow('', null),
    contact_email: Joi.string().email().allow('', null),
    country: Joi.string().max(100),
    timezone: Joi.string().max(50),
    is_active: Joi.boolean(),
});

// ============================================
// Factory Schemas
// ============================================
const createFactorySchema = Joi.object({
    name: Joi.string().min(2).max(255).required(),
    location_address: Joi.string().allow('', null),
    city: Joi.string().max(100).allow('', null),
    latitude: Joi.number().min(-90).max(90).allow(null),
    longitude: Joi.number().min(-180).max(180).allow(null),
    timezone: Joi.string().max(50).default('Europe/Madrid'),
});

// ============================================
// User Schemas
// ============================================
const createUserSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    first_name: Joi.string().min(1).max(100).required(),
    last_name: Joi.string().min(1).max(100).required(),
    role: Joi.string().valid('manager', 'gerencia', 'operador').required(),
    phone: Joi.string().max(20).allow('', null),
    factory_ids: Joi.array().items(Joi.string().uuid()).default([]),
});

const updateUserSchema = Joi.object({
    first_name: Joi.string().min(1).max(100),
    last_name: Joi.string().min(1).max(100),
    phone: Joi.string().max(20).allow('', null),
    is_active: Joi.boolean(),
});

const updateUserAccessSchema = Joi.object({
    factory_ids: Joi.array().items(Joi.string().uuid()).required(),
});

// ============================================
// Device Schemas
// ============================================
const createDeviceSchema = Joi.object({
    name: Joi.string().min(1).max(255).required(),
    serial_number: Joi.string().max(100).allow('', null),
    device_type: Joi.string().valid('monofasica', 'trifasica', 'master').required(),
    modbus_address: Joi.number().integer().min(1).max(247).required(),
    model: Joi.string().max(100).default('EM340'),
    description: Joi.string().allow('', null),
    metadata: Joi.object().default({}),
    host: Joi.string().ip({ version: ['ipv4'] }).allow(null),
    port: Joi.number().integer().min(1).max(65535).default(502),
});

// ============================================
// Contract Schemas
// ============================================
const createContractSchema = Joi.object({
    factory_id: Joi.string().uuid().allow(null),
    provider: Joi.string().min(1).max(255).required(),
    contract_number: Joi.string().max(100).allow('', null),
    contracted_power_kw: Joi.number().positive().allow(null),
    price_kwh_default: Joi.number().positive().required(),
    tariff_periods: Joi.object().default({}),
    currency: Joi.string().max(3).default('EUR'),
    start_date: Joi.date().required(),
    end_date: Joi.date().allow(null),
});

// ============================================
// Telemetry Schemas
// ============================================
const telemetryIngestSchema = Joi.object({
    factory_id: Joi.string().uuid().required(),
    device_id: Joi.string().uuid().required(),
    device_type: Joi.string().valid('monofasica', 'trifasica', 'master').required(),
    timestamp: Joi.date().iso().required(),
    data: Joi.object().required(),
});

const telemetryBatchSchema = Joi.object({
    readings: Joi.array().items(telemetryIngestSchema).min(1).required(),
});

// ============================================
// Query Schemas
// ============================================
const historyQuerySchema = Joi.object({
    start: Joi.date().iso().required(),
    end: Joi.date().iso().required(),
    interval: Joi.string().valid('raw', '1m', '5m', '15m', '1h', '1d').default('1h'),
    device_id: Joi.string().uuid(),
});

// ============================================
// Validation Middleware
// ============================================
const validate = (schema, property = 'body') => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[property], { abortEarly: false });
        if (error) {
            const errors = error.details.map((detail) => ({
                field: detail.path.join('.'),
                message: detail.message,
            }));
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors,
            });
        }
        req[property] = value;
        next();
    };
};

module.exports = {
    loginSchema,
    refreshSchema,
    createCompanySchema,
    updateCompanySchema,
    createFactorySchema,
    createUserSchema,
    updateUserSchema,
    updateUserAccessSchema,
    createDeviceSchema,
    createContractSchema,
    telemetryIngestSchema,
    telemetryBatchSchema,
    historyQuerySchema,
    validate,
};
