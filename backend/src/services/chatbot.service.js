/**
 * Voltio AI — Energy Chatbot Service (Function Calling Architecture)
 * 
 * Hybrid approach:
 *   1. Minimal static context (factory, devices, contract) — ~500 tokens
 *   2. 8 predefined tools for common queries
 *   3. 1 smart query fallback (NL → SQL with guardrails)
 * 
 * Security model:
 *   - factoryId injected server-side from JWT, NEVER a tool parameter
 *   - Smart query: SELECT only, whitelisted tables, parameterized
 *   - Blocked tables: users, companies, refresh_tokens, audit_log
 */

const OpenAI = require('openai');
const config = require('../config/env');
const db = require('../config/database');
const costService = require('./cost.service');
const reportService = require('./report.service');
const { getFactoryTimezone, getLocalDateStr } = require('../utils/timezone');

// ── OpenAI Client ──────────────────────────────────────────────
let openai = null;
const getClient = () => {
    if (!openai) {
        if (!config.openai.apiKey) {
            throw new Error('OPENAI_API_KEY not configured');
        }
        openai = new OpenAI({ apiKey: config.openai.apiKey });
    }
    return openai;
};

// ═══════════════════════════════════════════════════════════════
// 1. MINIMAL STATIC CONTEXT (factory info, devices, contract)
// ═══════════════════════════════════════════════════════════════

const buildMinimalContext = async (factoryId) => {
    const context = {};

    // Factory info
    try {
        const factoryResult = await db.query(
            `SELECT f.id, f.name, f.location_address, f.comunidad_autonoma, f.timezone,
                    f.latitude, f.longitude, f.city,
                    c.name AS company_name
             FROM factories f
             JOIN companies c ON c.id = f.company_id
             WHERE f.id = $1`,
            [factoryId]
        );
        context.factory = factoryResult.rows[0] || {};
    } catch (e) {
        context.factory = {};
    }

    // All active devices
    try {
        const devResult = await db.query(
            `SELECT id, name, device_type, device_role, model,
                    parent_device_id, parent_relation
             FROM devices 
             WHERE factory_id = $1 AND is_active = true
             ORDER BY device_role, name`,
            [factoryId]
        );
        context.devices = devResult.rows;
    } catch (e) {
        console.error('[Chatbot] Device query failed:', e.message);
        context.devices = [];
    }

    // Active contract
    try {
        const contract = await costService.getActiveContract(factoryId);
        if (contract) {
            context.contract = {
                tariff_type: contract.tariff_type,
                pricing_model: contract.pricing_model,
                power_p1_kw: contract.power_p1_kw,
                power_p2_kw: contract.power_p2_kw,
                power_p3_kw: contract.power_p3_kw,
                power_p4_kw: contract.power_p4_kw,
                power_p5_kw: contract.power_p5_kw,
                power_p6_kw: contract.power_p6_kw,
                electricity_tax: contract.electricity_tax,
                iva: contract.iva,
            };
        }
    } catch (e) {
        context.contract = null;
    }

    return context;
};

// ═══════════════════════════════════════════════════════════════
// 2. SYSTEM PROMPT (SLIM — no pre-loaded data)
// ═══════════════════════════════════════════════════════════════

const buildSystemPrompt = (ctx) => {
    const factoryName = ctx.factory?.name || 'Fábrica';
    const companyName = ctx.factory?.company_name || 'Empresa';

    // Device list with hierarchy
    const deviceList = (ctx.devices || []).map(d => {
        const parent = d.parent_device_id
            ? ctx.devices.find(p => p.id === d.parent_device_id)
            : null;
        const parentStr = parent ? ` → hijo de "${parent.name}"` : '';
        return `  - ${d.name} (${d.device_type}, rol: ${d.device_role || 'sub-meter'}${parentStr})`;
    }).join('\n');

    return `Eres **Voltio AI**, el asistente de inteligencia energética de la plataforma Voltio.
Eres un experto en eficiencia energética industrial, análisis de consumos eléctricos, optimización de costes,
energía solar, regulación eléctrica española, y sostenibilidad. Actúas como un ingeniero energético senior
que asesora a fábricas.

═══════════════════════════════════════════════════
█  REGLAS ABSOLUTAS (NUNCA VIOLAR)
═══════════════════════════════════════════════════
1. Tu fábrica principal es "${factoryName}" de "${companyName}". Centra tus análisis en ella.
2. NUNCA reveles información de otras fábricas o empresas.
3. Responde SIEMPRE en el mismo idioma que el usuario.
4. Usa formato Markdown. Sé preciso con los números.
5. Costes en €, energía en kWh, potencia en kW.
6. SIEMPRE usa las herramientas disponibles para obtener datos ANTES de responder. NUNCA inventes datos de consumo.
7. Si necesitas datos de un rango de fechas, usa las herramientas. NO digas que no tienes acceso.

═══════════════════════════════════════════════════
█  FLEXIBILIDAD Y CONOCIMIENTO
═══════════════════════════════════════════════════
Puedes y DEBES usar tu conocimiento general de ingeniería para responder preguntas relacionadas:
- **Energía solar**: estimar producción según ubicación, orientación, clima típico de la zona.
- **Clima y meteorología**: usar datos climáticos históricos de la zona para estimaciones.
- **Regulación**: normativa española (RD 244/2019, RD 1183/2020, etc.).
- **Eficiencia**: recomendaciones de mejora, ROI de inversiones, auditorías.
- **Comparativas**: benchmarks del sector industrial.
- **Cálculos teóricos**: dimensionamiento, amortización, huella de carbono.

Si no tienes datos exactos, ofrece ESTIMACIONES con tus conocimientos de ingeniería,
indicando claramente que son aproximaciones. NUNCA digas "no puedo ayudarte" si la pregunta
está relacionada con energía, industria o sostenibilidad.

═══════════════════════════════════════════════════
█  INFO DE LA FÁBRICA
═══════════════════════════════════════════════════
📍 Fábrica: ${factoryName}
🏢 Empresa: ${companyName}
📍 Ubicación: ${ctx.factory?.location_address || 'No especificada'} (${ctx.factory?.comunidad_autonoma || 'España'})
📅 Fecha actual: ${new Date().toISOString().split('T')[0]}

⚡ DISPOSITIVOS (${ctx.devices?.length || 0} activos):
${deviceList || 'Sin dispositivos'}

📑 CONTRATO:
  - Tarifa: ${ctx.contract?.tariff_type || 'N/A'}
  - Modelo: ${ctx.contract?.pricing_model || 'N/A'}
  - Potencias: P1=${ctx.contract?.power_p1_kw || 0} kW, P2=${ctx.contract?.power_p2_kw || 0} kW, P3=${ctx.contract?.power_p3_kw || 0} kW
  - Impuesto eléctrico: ${ctx.contract?.electricity_tax || 5.11}%, IVA: ${ctx.contract?.iva || 21}%

═══════════════════════════════════════════════════
█  CÓMO RESPONDER
═══════════════════════════════════════════════════
1. Cuando el usuario pregunte algo, USA LAS HERRAMIENTAS para obtener datos reales.
2. Puedes llamar MÚLTIPLES herramientas si necesitas cruzar datos.
3. Si una herramienta específica no cubre la pregunta, usa custom_energy_query.
4. Después de obtener los datos, responde con análisis y recomendaciones.
5. Incluye gráficos cuando ayuden a visualizar la respuesta.

═══════════════════════════════════════════════════
█  GRÁFICOS Y VISUALIZACIONES
═══════════════════════════════════════════════════
Incluye bloques gráficos envueltos entre %%%CHART_START%%% y %%%CHART_END%%%.

Formatos: "bar", "line", "pie", "bar" con orient "horizontal"

Ejemplo:
%%%CHART_START%%%
{
  "type": "bar",
  "title": "Consumo mensual",
  "xAxis": ["Enero", "Febrero"],
  "series": [{ "name": "kWh", "data": [1200, 1350], "color": "#22d3ee" }],
  "yAxisLabel": "kWh"
}
%%%CHART_END%%%

Colores: #22d3ee cyan, #a78bfa violeta, #34d399 verde, #f97316 naranja, #ef4444 rojo, #eab308 amarillo

═══════════════════════════════════════════════════
█  DIAGRAMAS MERMAID
═══════════════════════════════════════════════════
Para diagramas, usa bloques entre %%%MERMAID_START%%% y %%%MERMAID_END%%%.
SIEMPRE genera el diagrama cuando se pida — usa la lista de dispositivos.
Labels entre comillas dobles dentro de corchetes: ["Label"]

═══════════════════════════════════════════════════
█  CAPACIDADES
═══════════════════════════════════════════════════
- Consultar consumo y coste de CUALQUIER rango de fechas
- Desglosar por máquina, por hora, por día
- Analizar demanda de potencia vs contratada
- Detectar anomalías y tendencias
- Sugerir optimizaciones (potencia contratada, horarios, etc.)
- Generar gráficos y diagramas
- Responder preguntas complejas con la herramienta custom_energy_query`;
};

// ═══════════════════════════════════════════════════════════════
// 3. TOOL DEFINITIONS (OpenAI Function Calling Schema)
// ═══════════════════════════════════════════════════════════════

const TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'get_consumption_summary',
            description: 'Get total energy consumption (kWh), cost (€), average price, and peak power for the factory in a date range. Use for questions like "how much did the factory consume in January?" or "what was the cost last week?"',
            parameters: {
                type: 'object',
                properties: {
                    from: { type: 'string', description: 'Start date in ISO format, e.g. "2026-01-15T00:00:00"' },
                    to: { type: 'string', description: 'End date in ISO format, e.g. "2026-01-20T00:00:00"' },
                },
                required: ['from', 'to'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_device_breakdown',
            description: 'Get per-device consumption breakdown (kWh, cost, percentage) for a date range. Use for "which machine consumed the most?" or "compare device consumption this month".',
            parameters: {
                type: 'object',
                properties: {
                    from: { type: 'string', description: 'Start date ISO' },
                    to: { type: 'string', description: 'End date ISO' },
                },
                required: ['from', 'to'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_daily_cost',
            description: 'Get hourly cost and consumption breakdown for a specific day. Shows each hour with kWh, cost, and tariff period. Use for "how much did today cost?" or "show hourly breakdown for March 15".',
            parameters: {
                type: 'object',
                properties: {
                    date: { type: 'string', description: 'Date in YYYY-MM-DD format, e.g. "2026-03-15"' },
                },
                required: ['date'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_realtime_readings',
            description: 'Get current real-time readings from all active devices: power (W), voltage, current, power factor. Use for "what is the current consumption?" or "how much power is being used right now?".',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_device_report',
            description: 'Get detailed report for a specific device: total kWh, cost, average/peak power, daily breakdown, and hourly pattern. Use for "tell me about the compressor consumption" or "report on device X for last month".',
            parameters: {
                type: 'object',
                properties: {
                    device_name: { type: 'string', description: 'Name of the device (exact or partial match)' },
                    from: { type: 'string', description: 'Start date ISO' },
                    to: { type: 'string', description: 'End date ISO' },
                },
                required: ['device_name', 'from', 'to'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_power_demand',
            description: 'Get power demand analysis: peak demand vs contracted power, demand curve over time. Use for "am I exceeding contracted power?" or "demand analysis for this month".',
            parameters: {
                type: 'object',
                properties: {
                    from: { type: 'string', description: 'Start date ISO' },
                    to: { type: 'string', description: 'End date ISO' },
                },
                required: ['from', 'to'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_alarms',
            description: 'Get alarm history for the factory: overvoltage, overcurrent, low power factor, device offline, etc. Use for "any alarms this week?" or "show critical alerts".',
            parameters: {
                type: 'object',
                properties: {
                    from: { type: 'string', description: 'Start date ISO' },
                    to: { type: 'string', description: 'End date ISO' },
                    severity: { type: 'string', enum: ['info', 'warning', 'critical'], description: 'Optional: filter by severity' },
                },
                required: ['from', 'to'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_hourly_consumption',
            description: 'Get hourly consumption curve (kWh per hour) for a date range, optionally filtered by device. Use for "show me the consumption pattern" or "hourly profile for the compressor yesterday".',
            parameters: {
                type: 'object',
                properties: {
                    from: { type: 'string', description: 'Start date ISO' },
                    to: { type: 'string', description: 'End date ISO' },
                    device_name: { type: 'string', description: 'Optional: specific device name' },
                },
                required: ['from', 'to'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'custom_energy_query',
            description: 'Fallback tool for complex questions not covered by other tools. Describe what data you need in natural language and the system will query the database safely. Use for very specific or unusual data requests. Examples: "average power factor by hour for each device last month", "top 5 hours with highest consumption ever", "correlation between voltage and power factor".',
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: 'Natural language description of the data needed' },
                },
                required: ['question'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_weather_forecast',
            description: 'Get weather forecast for the factory location: temperature, solar radiation, cloud cover, rain probability, wind. Use for solar energy estimates, climate impact on consumption, and planning. Provides 7-day hourly forecast.',
            parameters: {
                type: 'object',
                properties: {
                    days: { type: 'integer', description: 'Number of forecast days (1-7, default 7)', default: 7 },
                },
            },
        },
    },
];

// ═══════════════════════════════════════════════════════════════
// 4. TOOL EXECUTORS (factory-scoped, secure)
// ═══════════════════════════════════════════════════════════════

const executeToolCall = async (toolName, args, factoryId, ctx) => {
    switch (toolName) {
        case 'get_consumption_summary':
            return await execConsumptionSummary(factoryId, args);

        case 'get_device_breakdown':
            return await execDeviceBreakdown(factoryId, args);

        case 'get_daily_cost':
            return await execDailyCost(factoryId, args);

        case 'get_realtime_readings':
            return await execRealtimeReadings(factoryId);

        case 'get_device_report':
            return await execDeviceReport(factoryId, args, ctx);

        case 'get_power_demand':
            return await execPowerDemand(factoryId, args);

        case 'get_alarms':
            return await execAlarms(factoryId, args);

        case 'get_hourly_consumption':
            return await execHourlyConsumption(factoryId, args, ctx);

        case 'custom_energy_query':
            return await execCustomQuery(factoryId, args, ctx);

        case 'get_weather_forecast':
            return await execWeatherForecast(args, ctx);

        default:
            return { error: `Unknown tool: ${toolName}` };
    }
};

// ── Tool: Consumption Summary ──
const execConsumptionSummary = async (factoryId, { from, to }) => {
    try {
        const summary = await reportService.getSummary(factoryId, from, to);
        return {
            total_kwh: summary.total_kwh,
            total_cost: summary.total_cost,
            avg_price_kwh: summary.avg_price_kwh,
            peak_kw: summary.peak_kw,
            contracted_power_kw: summary.contracted_power_kw,
            period: `${from} → ${to}`,
        };
    } catch (e) {
        return { error: e.message };
    }
};

// ── Tool: Device Breakdown ──
const execDeviceBreakdown = async (factoryId, { from, to }) => {
    try {
        const breakdown = await reportService.getDeviceBreakdown(factoryId, from, to);
        return {
            period: `${from} → ${to}`,
            total_kwh: breakdown.total_kwh,
            devices: (breakdown.devices || []).map(d => ({
                name: d.device_name,
                type: d.device_type,
                role: d.device_role,
                kwh: d.kwh,
                cost_eur: d.cost_eur,
                percentage: d.percentage,
                avg_kw: d.avg_kw,
                peak_kw: d.peak_kw,
            })),
        };
    } catch (e) {
        return { error: e.message };
    }
};

// ── Tool: Daily Cost ──
const execDailyCost = async (factoryId, { date }) => {
    try {
        const daily = await costService.getDailyCostBreakdown(factoryId, date);
        return {
            date: daily.date,
            total_kwh: daily.total_kwh,
            total_cost: daily.total_cost,
            hours: (daily.hours || []).filter(h => h.kwh > 0).map(h => ({
                hour: `${String(h.hour).padStart(2, '0')}:00`,
                kwh: h.kwh,
                cost: h.cost,
                period: h.period,
                price_kwh: h.price_kwh,
            })),
        };
    } catch (e) {
        return { error: e.message };
    }
};

// ── Tool: Realtime Readings ──
const execRealtimeReadings = async (factoryId) => {
    try {
        const result = await db.query(
            `SELECT tr.device_id, d.name AS device_name, tr.data, tr.last_updated
             FROM telemetry_realtime tr
             JOIN devices d ON d.id = tr.device_id
             WHERE d.factory_id = $1 AND d.is_active = true`,
            [factoryId]
        );
        return {
            timestamp: new Date().toISOString(),
            devices: result.rows.map(r => ({
                device: r.device_name,
                power_w: r.data?.power_w_total || r.data?.power_w || 0,
                voltage_l1: r.data?.voltage_l1_n || 0,
                voltage_l2: r.data?.voltage_l2_n || 0,
                voltage_l3: r.data?.voltage_l3_n || 0,
                current_l1: r.data?.current_l1 || 0,
                current_l2: r.data?.current_l2 || 0,
                current_l3: r.data?.current_l3 || 0,
                power_factor: r.data?.power_factor || 0,
                frequency: r.data?.frequency_hz || 0,
                last_updated: r.last_updated,
            })),
        };
    } catch (e) {
        return { error: e.message };
    }
};

// ── Tool: Device Report ──
const execDeviceReport = async (factoryId, { device_name, from, to }, ctx) => {
    try {
        // Find device by name (fuzzy match)
        const device = (ctx.devices || []).find(d =>
            d.name.toLowerCase().includes(device_name.toLowerCase())
        );
        if (!device) return { error: `Device "${device_name}" not found in this factory` };

        const report = await reportService.getDeviceReport(factoryId, device.id, from, to);
        const kpis = report.kpis || {};
        return {
            device_name: device.name,
            device_type: device.device_type,
            period: `${from} → ${to}`,
            total_kwh: kpis.total_kwh,
            estimated_cost_eur: kpis.estimated_cost_eur,
            avg_kw: kpis.avg_kw,
            peak_kw: kpis.peak_kw,
            peak_kw_time: kpis.peak_kw_time,
            avg_power_factor: kpis.avg_pf,
            load_factor_percent: kpis.load_factor,
            operating_hours: kpis.operating_hours,
            timeline: (report.timeline || []).slice(0, 50).map(d => ({
                date: d.bucket || d.date,
                kwh: d.delta_kwh || d.kwh,
                peak_kw: d.max_power_w ? (d.max_power_w / 1000) : d.peak_kw,
            })),
        };
    } catch (e) {
        return { error: e.message };
    }
};

// ── Tool: Power Demand ──
const execPowerDemand = async (factoryId, { from, to }) => {
    try {
        const demand = await reportService.getPowerDemand(factoryId, from, to);
        return {
            period: `${from} → ${to}`,
            peak_demand_kw: demand.peak_demand_kw,
            avg_demand_kw: demand.avg_demand_kw,
            contracted_power_kw: demand.contracted_power_kw,
            excess_count: demand.excess_count,
            demand_curve: (demand.demand_curve || []).slice(0, 100),
        };
    } catch (e) {
        return { error: e.message };
    }
};

// ── Tool: Alarms ──
const execAlarms = async (factoryId, { from, to, severity }) => {
    try {
        let query = `
            SELECT a.id, a.alarm_type, a.severity, a.message, 
                   a.value_detected, a.threshold_value,
                   a.acknowledged, a.triggered_at,
                   d.name AS device_name
            FROM alarms a
            LEFT JOIN devices d ON d.id = a.device_id
            WHERE a.factory_id = $1
            AND a.triggered_at >= $2::timestamptz
            AND a.triggered_at < $3::timestamptz
        `;
        const params = [factoryId, from, to];

        if (severity) {
            query += ` AND a.severity = $4`;
            params.push(severity);
        }

        query += ` ORDER BY a.triggered_at DESC LIMIT 100`;

        const result = await db.query(query, params);
        return {
            period: `${from} → ${to}`,
            total_alarms: result.rows.length,
            alarms: result.rows.map(a => ({
                type: a.alarm_type,
                severity: a.severity,
                device: a.device_name || 'Factory',
                message: a.message,
                value: a.value_detected,
                threshold: a.threshold_value,
                acknowledged: a.acknowledged,
                time: a.triggered_at,
            })),
        };
    } catch (e) {
        return { error: e.message };
    }
};

// ── Tool: Hourly Consumption ──
const execHourlyConsumption = async (factoryId, { from, to, device_name }, ctx) => {
    try {
        let deviceFilter = '';
        const params = [factoryId, from, to];

        if (device_name) {
            const device = (ctx.devices || []).find(d =>
                d.name.toLowerCase().includes(device_name.toLowerCase())
            );
            if (!device) return { error: `Device "${device_name}" not found` };
            deviceFilter = ` AND th.device_id = $4`;
            params.push(device.id);
        }

        const result = await db.query(`
            SELECT 
                th.bucket,
                ${device_name ? '' : "string_agg(DISTINCT d.name, ', ') AS devices,"}
                SUM(th.delta_kwh) AS kwh,
                AVG(th.avg_power_w) AS avg_power_w,
                MAX(th.max_power_w) AS max_power_w,
                AVG(th.avg_power_factor) AS avg_pf
            FROM telemetry_hourly th
            JOIN devices d ON d.id = th.device_id
            WHERE d.factory_id = $1
            AND th.bucket >= $2::timestamptz
            AND th.bucket < $3::timestamptz
            ${deviceFilter}
            GROUP BY th.bucket
            ORDER BY th.bucket
            LIMIT 500
        `, params);

        return {
            period: `${from} → ${to}`,
            device: device_name || 'All devices',
            hours: result.rows.map(r => ({
                time: r.bucket,
                kwh: parseFloat(r.kwh) || 0,
                avg_kw: parseFloat(r.avg_power_w) / 1000 || 0,
                peak_kw: parseFloat(r.max_power_w) / 1000 || 0,
            })),
        };
    } catch (e) {
        return { error: e.message };
    }
};

// ═══════════════════════════════════════════════════════════════
// 5. WEATHER FORECAST (Open-Meteo API — free, no key)
// ═══════════════════════════════════════════════════════════════

const execWeatherForecast = async ({ days = 7 }, ctx) => {
    try {
        const lat = ctx.factory?.latitude;
        const lon = ctx.factory?.longitude;
        const city = ctx.factory?.city || 'Unknown';

        if (!lat || !lon) {
            return { error: `Factory coordinates not configured. City: ${city}` };
        }

        const forecastDays = Math.min(Math.max(days || 7, 1), 7);

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
            `&daily=temperature_2m_max,temperature_2m_min,sunshine_duration,shortwave_radiation_sum,` +
            `precipitation_sum,precipitation_probability_max,cloud_cover_mean,wind_speed_10m_max` +
            `&timezone=Europe/Madrid&forecast_days=${forecastDays}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Open-Meteo API error: ${response.status}`);

        const data = await response.json();
        const daily = data.daily || {};

        const forecast = (daily.time || []).map((date, i) => ({
            date,
            temp_max_c: daily.temperature_2m_max?.[i],
            temp_min_c: daily.temperature_2m_min?.[i],
            sunshine_hours: daily.sunshine_duration?.[i] ? Math.round(daily.sunshine_duration[i] / 3600 * 10) / 10 : 0,
            solar_radiation_kwh_m2: daily.shortwave_radiation_sum?.[i] ? Math.round(daily.shortwave_radiation_sum[i] / 1000 * 100) / 100 : 0,
            rain_mm: daily.precipitation_sum?.[i],
            rain_probability_pct: daily.precipitation_probability_max?.[i],
            cloud_cover_pct: daily.cloud_cover_mean?.[i],
            wind_max_kmh: daily.wind_speed_10m_max?.[i],
        }));

        return {
            location: city,
            coordinates: { lat, lon },
            forecast_days: forecastDays,
            forecast,
            note: 'Solar radiation in kWh/m². Multiply by panel area (m²) × efficiency (~0.18-0.22) for estimated production.',
        };
    } catch (e) {
        return { error: `Weather forecast failed: ${e.message}` };
    }
};

// ═══════════════════════════════════════════════════════════════
// 6. SMART QUERY (NL → SQL with guardrails)
// ═══════════════════════════════════════════════════════════════

// Whitelisted tables the AI can query
const ALLOWED_TABLES = [
    'devices',
    'telemetry',
    'telemetry_hourly',
    'telemetry_daily',
    'telemetry_realtime',
    'cost_snapshots',
    'contracts',
    'alarms',
    'alarm_thresholds',
    'production_lines',
    'production_line_devices',
    'device_hierarchy_log',
    'electricity_prices',
    'holidays',
];

// Blocked tables (sensitive data)
const BLOCKED_TABLES = [
    'users', 'companies', 'refresh_tokens', 'audit_log',
    'vector_embeddings', 'user_factory_access',
];

const SQL_GENERATION_PROMPT = `You are a SQL expert for a TimescaleDB energy monitoring database.
Generate a SINGLE PostgreSQL SELECT query to answer the user's question.

RULES:
1. ONLY SELECT statements. NEVER INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE.
2. ONLY use these tables: ${ALLOWED_TABLES.join(', ')}
3. NEVER use these tables: ${BLOCKED_TABLES.join(', ')}
4. The factory_id filter is ALREADY applied — use $1 as the factory_id parameter.
5. For device tables, filter with: factory_id = $1
6. For telemetry, JOIN with devices: JOIN devices d ON d.id = t.device_id WHERE d.factory_id = $1
7. For cost_snapshots: WHERE factory_id = $1
8. For alarms: WHERE factory_id = $1
9. LIMIT results to 200 rows max.
10. Return ONLY the SQL query, nothing else. No markdown, no explanation.

SCHEMA REFERENCE:
- telemetry: time, device_id, voltage_l1_n/l2_n/l3_n, current_l1/l2/l3, power_w_total/l1/l2/l3, power_va_total, power_var_total, power_factor, frequency_hz, energy_kwh_total, demand_w
- telemetry_hourly: bucket, device_id, avg_power_w, max_power_w, min_power_w, delta_kwh, avg_power_factor, sample_count
- telemetry_daily: bucket, device_id, avg_power_w, max_power_w, delta_kwh, avg_power_factor
- devices: id, factory_id, name, device_type, device_role, model, parent_device_id
- cost_snapshots: timestamp, factory_id, period (P1-P6), price_kwh, kwh_consumed, cost_eur, pricing_model
- contracts: factory_id, provider, contracted_power_kw, tariff_periods, start_date, end_date
- alarms: factory_id, device_id, alarm_type, severity, message, value_detected, triggered_at
`;

const execCustomQuery = async (factoryId, { question }, ctx) => {
    try {
        const client = getClient();

        // Step 1: Generate SQL from natural language
        const sqlResponse = await client.chat.completions.create({
            model: config.openai.model,
            messages: [
                { role: 'system', content: SQL_GENERATION_PROMPT },
                { role: 'user', content: question },
            ],
            temperature: 0,
            max_tokens: 500,
        });

        let sql = sqlResponse.choices[0]?.message?.content?.trim() || '';

        // Remove markdown code fences if present
        sql = sql.replace(/^```(sql)?\n?/i, '').replace(/\n?```$/i, '').trim();

        // Step 2: Validate SQL (security guardrails)
        const validation = validateSQL(sql);
        if (!validation.valid) {
            return { error: `Query rejected: ${validation.reason}` };
        }

        // Step 3: Execute query with factory_id parameter
        const result = await db.query(sql, [factoryId]);

        return {
            question,
            sql_executed: sql,
            row_count: result.rows.length,
            data: result.rows.slice(0, 200), // Safety cap
        };
    } catch (e) {
        return { error: `Query failed: ${e.message}` };
    }
};

/**
 * Validate generated SQL to ensure it's safe.
 * Returns { valid: boolean, reason?: string }
 */
const validateSQL = (sql) => {
    if (!sql || sql.length === 0) {
        return { valid: false, reason: 'Empty query' };
    }

    const upper = sql.toUpperCase().replace(/\s+/g, ' ').trim();

    // Must start with SELECT (or WITH for CTEs)
    if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
        return { valid: false, reason: 'Only SELECT queries allowed' };
    }

    // Block dangerous keywords
    const dangerous = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'EXEC', 'EXECUTE', 'GRANT', 'REVOKE'];
    for (const keyword of dangerous) {
        // Check for keyword as standalone word (not part of another word)
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        if (regex.test(sql) && keyword !== 'CREATE') {
            return { valid: false, reason: `Forbidden keyword: ${keyword}` };
        }
        // For CREATE, be more specific — it could appear in comments
        if (keyword === 'CREATE' && /\bCREATE\s+(TABLE|INDEX|VIEW|FUNCTION|TRIGGER|ROLE)\b/i.test(sql)) {
            return { valid: false, reason: `Forbidden operation: CREATE` };
        }
    }

    // Check for blocked tables
    for (const table of BLOCKED_TABLES) {
        const regex = new RegExp(`\\b${table}\\b`, 'i');
        if (regex.test(sql)) {
            return { valid: false, reason: `Access to table "${table}" is blocked` };
        }
    }

    // Must contain $1 (factory_id parameter) or be about global tables (electricity_prices, holidays)
    const globalTables = ['electricity_prices', 'holidays'];
    const isGlobalOnly = globalTables.some(t => sql.toLowerCase().includes(t))
        && !ALLOWED_TABLES.filter(t => !globalTables.includes(t)).some(t => {
            const regex = new RegExp(`\\b${t}\\b`, 'i');
            return regex.test(sql);
        });

    if (!sql.includes('$1') && !isGlobalOnly) {
        return { valid: false, reason: 'Query must include factory_id filter ($1)' };
    }

    // Query length limit
    if (sql.length > 2000) {
        return { valid: false, reason: 'Query too long (max 2000 chars)' };
    }

    return { valid: true };
};

// ═══════════════════════════════════════════════════════════════
// 6. CHAT (Tool-call loop)
// ═══════════════════════════════════════════════════════════════

/**
 * Main chat function with tool-call loop.
 * 
 * @param {string} factoryId - Injected from JWT (NEVER from AI)
 * @param {Array} messages - Conversation history
 * @param {string} userId - For audit
 * @returns {Promise<{message, charts, diagrams, usage}>}
 */
const chat = async (factoryId, messages, userId) => {
    const client = getClient();

    // Build minimal context
    const ctx = await buildMinimalContext(factoryId);
    const systemPrompt = buildSystemPrompt(ctx);

    // Prepare messages
    const openaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content,
        })),
    ];

    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const MAX_ITERATIONS = 5;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        // Call OpenAI with tools
        const completion = await client.chat.completions.create({
            model: config.openai.model,
            messages: openaiMessages,
            tools: TOOL_DEFINITIONS,
            tool_choice: 'auto',
            temperature: 0.3,
            max_tokens: 4096,
        });

        // Accumulate token usage
        totalUsage.prompt_tokens += completion.usage?.prompt_tokens || 0;
        totalUsage.completion_tokens += completion.usage?.completion_tokens || 0;
        totalUsage.total_tokens += completion.usage?.total_tokens || 0;

        const responseMessage = completion.choices[0]?.message;

        // If no tool calls, we have the final response
        if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
            const responseContent = responseMessage.content || '';

            // Extract charts
            const charts = [];
            const chartRegex = /%%%CHART_START%%%([\s\S]*?)%%%CHART_END%%%/g;
            let match;
            while ((match = chartRegex.exec(responseContent)) !== null) {
                try {
                    charts.push(JSON.parse(match[1].trim()));
                } catch (e) {
                    console.warn('[Chatbot] Failed to parse chart:', e.message);
                }
            }

            // Extract Mermaid diagrams
            const diagrams = [];
            const mermaidRegex = /%%%MERMAID_START%%%([\s\S]*?)%%%MERMAID_END%%%/g;
            let mMatch;
            while ((mMatch = mermaidRegex.exec(responseContent)) !== null) {
                const code = mMatch[1].trim();
                if (code) diagrams.push(code);
            }

            // Clean response
            const cleanMessage = responseContent
                .replace(/%%%CHART_START%%%[\s\S]*?%%%CHART_END%%%/g, '')
                .replace(/%%%MERMAID_START%%%[\s\S]*?%%%MERMAID_END%%%/g, '')
                .trim();

            return {
                message: cleanMessage,
                charts,
                diagrams,
                usage: totalUsage,
            };
        }

        // Tool calls — execute and feed results back
        openaiMessages.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs = {};
            try {
                toolArgs = JSON.parse(toolCall.function.arguments);
            } catch (e) {
                toolArgs = {};
            }

            console.log(`[Chatbot] Tool call: ${toolName}(${JSON.stringify(toolArgs)})`);

            // Execute tool (factoryId injected server-side — SECURE)
            const result = await executeToolCall(toolName, toolArgs, factoryId, ctx);

            // Add tool result to conversation
            openaiMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
            });
        }
    }

    // Safety: if we hit max iterations, return what we have
    return {
        message: 'He recopilado los datos pero necesito más iteraciones para responder completamente. ¿Puedes reformular tu pregunta de forma más específica?',
        charts: [],
        diagrams: [],
        usage: totalUsage,
    };
};

// ── Text-to-Speech ─────────────────────────────────────────────
const textToSpeech = async (text) => {
    const client = getClient();
    const truncated = text.length > 4000 ? text.substring(0, 4000) + '...' : text;

    const mp3 = await client.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: truncated,
        response_format: 'mp3',
        speed: 1.0,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    return buffer;
};

module.exports = {
    chat,
    textToSpeech,
    buildMinimalContext,
};
