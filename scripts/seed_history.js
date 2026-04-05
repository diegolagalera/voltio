/**
 * Seed 5 days of historical telemetry + cost_snapshots
 * Run: node scripts/seed_history.js
 */
const db = require('../backend/src/config/database');

const FACTORY_ID = '91ddc8de-a84e-4d98-88ef-95b5a78747a2';
const CONTRACT_ID = '150dfd1f-0711-483a-a394-a7ed9bbabf53';

// Device profiles: { id, name, type, baseKw, peakKw, nightFactor }
const DEVICES = [
    { id: 'eabd9ae7-2503-4f57-8f0c-7e81ec2e984b', name: 'Contador General', type: 'trifasica', baseKw: 0, isGeneral: true },
    { id: '715e132b-4c00-4e28-a86a-b567e26cb910', name: 'CNC Fresadora', type: 'trifasica', baseKw: 3.5, peakKw: 8.0, nightFactor: 0.05 },
    { id: 'fe29f821-f4c2-4f93-855f-f13f663c405a', name: 'Horno Industrial', type: 'trifasica', baseKw: 8.0, peakKw: 15.0, nightFactor: 0.3 },
    { id: '072389fa-b3e2-4379-9db6-b4c1e15fe83e', name: 'Compresor 1', type: 'trifasica', baseKw: 4.0, peakKw: 7.5, nightFactor: 0.2 },
    { id: '63abb2dd-f831-45e7-8fbd-2357f4d84fa9', name: 'Compresor 2', type: 'trifasica', baseKw: 1.0, peakKw: 5.0, nightFactor: 0.1 },
    { id: 'f4fd0f1f-cda2-4544-8291-e9da581e08b4', name: 'Iluminación Nave', type: 'monofasica', baseKw: 2.0, peakKw: 3.5, nightFactor: 0.1 },
    { id: 'b81a874a-7c26-4278-aca4-5d129b1e5d2f', name: 'Iluminación Oficinas', type: 'monofasica', baseKw: 0.5, peakKw: 1.2, nightFactor: 0.05 },
    { id: '71ffbabf-5893-4d61-9191-b5dbf14445b3', name: 'HVAC Oficinas', type: 'monofasica', baseKw: 2.5, peakKw: 4.5, nightFactor: 0.15 },
    { id: 'cafc3458-d81e-46b9-801e-d73e2bfbe8ea', name: 'Prensa Hidráulica', type: 'trifasica', baseKw: 1.5, peakKw: 12.0, nightFactor: 0.0 },
];

// Period prices (fixed contract, €/kWh)
const PERIOD_PRICES = {
    P1: 0.28, P2: 0.24, P3: 0.20, P4: 0.16, P5: 0.12, P6: 0.08,
};

// Determine tariff period from hour (simplified 2.0TD peninsular)
function getPeriod(hour, isWeekend) {
    if (isWeekend) return 'P6';
    if (hour >= 10 && hour < 14) return 'P1';  // Punta mañana
    if (hour >= 18 && hour < 22) return 'P1';  // Punta tarde
    if (hour >= 8 && hour < 10) return 'P2';  // Llano alto
    if (hour >= 14 && hour < 18) return 'P2';  // Llano alto
    if (hour >= 22 && hour < 24) return 'P3';  // Llano
    if (hour >= 7 && hour < 8) return 'P3';  // Llano
    return 'P6';  // Super valle (0-7)
};

// Generate realistic power for a device at a given hour
function getDevicePower(device, hour, isWeekend) {
    if (device.isGeneral) return 0; // calculated as sum

    const rand = () => 0.85 + Math.random() * 0.3; // ±15% variation

    // Weekend: much lower consumption
    if (isWeekend) {
        return device.baseKw * (device.nightFactor || 0.1) * rand() * 1000; // return in Watts
    }

    // Work hours pattern (7-20): higher consumption
    if (hour >= 7 && hour < 20) {
        // Peak hours (10-14): highest
        if (hour >= 10 && hour < 14) {
            return (device.baseKw + (device.peakKw - device.baseKw) * 0.8 * rand()) * 1000;
        }
        // Normal work hours
        return device.baseKw * rand() * 1000;
    }

    // Night (20-7): low consumption
    return device.baseKw * (device.nightFactor || 0.1) * rand() * 1000;
}

async function seed() {
    console.log('🌱 Seeding 5 days of historical data...\n');

    // Clean existing data first
    console.log('  🗑  Cleaning existing data...');
    await db.query('DELETE FROM telemetry');
    await db.query('DELETE FROM cost_snapshots');
    console.log('  ✅ Tables cleaned\n');

    const now = new Date('2026-03-09T22:00:00+01:00');
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 5);
    startDate.setHours(0, 0, 0, 0);

    let telemetryCount = 0;
    let snapshotCount = 0;

    // Track cumulative energy_kwh_total per device (like a real meter)
    const energyCounters = {};
    for (const d of DEVICES) {
        energyCounters[d.id] = d.isGeneral ? 1000 : 100 + Math.random() * 500;
    }

    // Iterate day by day, hour by hour
    const current = new Date(startDate);
    while (current < now) {
        const hour = current.getHours();
        const dayOfWeek = current.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const period = getPeriod(hour, isWeekend);
        const priceKwh = PERIOD_PRICES[period];

        let totalFactoryW = 0;

        // Generate 4 readings per hour per device (every 15 min)
        for (let minute = 0; minute < 60; minute += 15) {
            const ts = new Date(current);
            ts.setMinutes(minute, Math.floor(Math.random() * 60), 0);

            let sumW = 0;

            for (const device of DEVICES) {
                if (device.isGeneral) continue;

                const powerW = getDevicePower(device, hour, isWeekend);
                sumW += powerW;

                // Increment energy counter (kWh consumed in this 15-min reading)
                const kwhThisReading = (powerW / 1000) * 0.25; // 15 min = 0.25 hour
                energyCounters[device.id] += kwhThisReading;

                const voltage = device.type === 'trifasica' ? 230 + Math.random() * 5 : 230 + Math.random() * 3;
                const pf = 0.85 + Math.random() * 0.12;
                const currentA = powerW / (voltage * pf * (device.type === 'trifasica' ? 1.732 : 1));

                await db.query(`
                  INSERT INTO telemetry (
                    time, device_id, device_type,
                    voltage_l1_n, voltage_l2_n, voltage_l3_n,
                    current_l1, current_l2, current_l3,
                    power_w_total, power_va_total, power_var_total,
                    power_factor, frequency_hz,
                    energy_kwh_total, raw_data
                  ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9,
                    $10, $11, $12, $13, $14, $15, $16
                  )`, [
                    ts.toISOString(), device.id, device.type,
                    voltage, device.type === 'trifasica' ? voltage + Math.random() * 2 : null,
                    device.type === 'trifasica' ? voltage - Math.random() * 2 : null,
                    currentA, device.type === 'trifasica' ? currentA * (0.95 + Math.random() * 0.1) : null,
                    device.type === 'trifasica' ? currentA * (0.9 + Math.random() * 0.1) : null,
                    powerW, powerW / pf, powerW * Math.tan(Math.acos(pf)),
                    pf, 50 + (Math.random() - 0.5) * 0.1,
                    Math.round(energyCounters[device.id] * 100) / 100,
                    JSON.stringify({ power_w_total: powerW, voltage_l1_n: voltage }),
                ]);

                telemetryCount++;
            }

            // Contador General = sum + ~10% overhead
            const generalW = sumW * (1.1 + Math.random() * 0.05);
            totalFactoryW += generalW;
            const generalKwhReading = (generalW / 1000) * 0.25;
            energyCounters['eabd9ae7-2503-4f57-8f0c-7e81ec2e984b'] += generalKwhReading;

            await db.query(`
              INSERT INTO telemetry (
                time, device_id, device_type,
                voltage_l1_n, voltage_l2_n, voltage_l3_n,
                current_l1, current_l2, current_l3,
                power_w_total, power_factor, frequency_hz,
                energy_kwh_total, raw_data
              ) VALUES ($1, $2, 'trifasica', 231, 230.5, 231.2, $3, $4, $5, $6, 0.92, 50, $7, $8)`, [
                ts.toISOString(),
                'eabd9ae7-2503-4f57-8f0c-7e81ec2e984b',
                generalW / (231 * 0.92 * 1.732),
                generalW / (231 * 0.92 * 1.732) * 0.98,
                generalW / (231 * 0.92 * 1.732) * 1.01,
                generalW,
                Math.round(energyCounters['eabd9ae7-2503-4f57-8f0c-7e81ec2e984b'] * 100) / 100,
                JSON.stringify({ power_w_total: generalW }),
            ]);
            telemetryCount++;
        }

        // Cost snapshot per hour
        const avgFactoryW = totalFactoryW / 4;
        const kwhConsumed = avgFactoryW / 1000;
        const costEur = kwhConsumed * priceKwh;

        await db.query(`
          INSERT INTO cost_snapshots (
            factory_id, contract_id, timestamp, period, price_kwh,
            kwh_consumed, cost_eur, pricing_model, breakdown
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'fixed', $8)
        `, [
            FACTORY_ID, CONTRACT_ID,
            current.toISOString(),
            period, priceKwh,
            Math.round(kwhConsumed * 100) / 100,
            Math.round(costEur * 100) / 100,
            JSON.stringify({ period, price_kwh: priceKwh, kwh: kwhConsumed, cost: costEur }),
        ]);
        snapshotCount++;

        if (hour === 0) {
            console.log(`  📅 ${current.toISOString().split('T')[0]} — generating...`);
        }

        current.setHours(current.getHours() + 1);
    }

    console.log(`\n✅ Done!`);
    console.log(`   📊 Telemetry: ${telemetryCount} rows`);
    console.log(`   💰 Cost snapshots: ${snapshotCount} rows`);
    console.log(`   📅 Period: ${startDate.toISOString().split('T')[0]} → ${now.toISOString().split('T')[0]}`);

    process.exit(0);
}

seed().catch(err => { console.error('Failed:', err.message); process.exit(1); });
