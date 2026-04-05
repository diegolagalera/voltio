#!/usr/bin/env node
/**
 * FPSaver — Create devices + Insert simulated telemetry (24h)
 * Run: node scripts/simulate_telemetry.js
 */
const db = require('../src/config/database');
const { hash } = require('../src/utils/password');

async function main() {
    const client = await db.getClient();

    try {
        // 1. Get factory
        console.log('[1] Getting factory...');
        let factory = (await client.query('SELECT * FROM factories LIMIT 1')).rows[0];
        if (!factory) {
            // Get company
            const company = (await client.query('SELECT id FROM companies LIMIT 1')).rows[0];
            if (!company) { console.error('No companies exist!'); process.exit(1); }
            const fRes = await client.query(
                `INSERT INTO factories (company_id, name, location_address, city, latitude, longitude, timezone, mqtt_topic)
                 VALUES ($1, 'Planta Bilbao Norte', 'Polígono Industrial Asúa, 12', 'Bilbao', 43.263, -2.935, 'Europe/Madrid', null) RETURNING *`,
                [company.id]
            );
            factory = fRes.rows[0];
            await client.query('UPDATE factories SET mqtt_topic = $1 WHERE id = $2', [`factory/${factory.id}`, factory.id]);
            console.log(`   Created factory: ${factory.name}`);
        } else {
            console.log(`   Factory: ${factory.name} (${factory.id.substring(0, 8)}...)`);
        }

        // 2. Get or create devices
        console.log('[2] Checking devices...');
        let devices = (await client.query('SELECT * FROM devices WHERE factory_id = $1', [factory.id])).rows;

        if (devices.length === 0) {
            console.log('   Creating 4 devices...');
            const devicesToCreate = [
                { name: 'Compresor 1', type: 'trifasica', addr: 1, model: 'EM340', sn: 'SN-CG-001' },
                { name: 'Compresor 2', type: 'trifasica', addr: 2, model: 'EM340', sn: 'SN-CG-002' },
                { name: 'Horno Industrial', type: 'trifasica', addr: 3, model: 'EM340', sn: 'SN-CG-003' },
                { name: 'Iluminación Nave', type: 'monofasica', addr: 4, model: 'EM111', sn: 'SN-CG-004' },
            ];
            for (const d of devicesToCreate) {
                const r = await client.query(
                    `INSERT INTO devices (factory_id, name, device_type, modbus_address, model, serial_number)
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                    [factory.id, d.name, d.type, d.addr, d.model, d.sn]
                );
                devices.push(r.rows[0]);
                console.log(`   ✓ ${d.name}`);
            }
        } else {
            console.log(`   ${devices.length} devices exist`);
        }

        // 3. Insert telemetry
        console.log('[3] Inserting 24h of simulated telemetry...');
        const now = new Date();
        let totalInserted = 0;

        await client.query('BEGIN');

        for (const device of devices) {
            const isTri = device.device_type === 'trifasica';
            let deviceReadings = 0;

            for (let i = 0; i < 288; i++) { // 24h * 12/h = 288 readings
                const ts = new Date(now.getTime() - i * 5 * 60 * 1000);
                const h = ts.getUTCHours();
                const loadFactor = (h >= 6 && h < 22)
                    ? 0.6 + 0.3 * Math.sin(Math.PI * (h - 6) / 16)
                    : 0.15 + 0.05 * Math.random();

                const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

                let data;
                if (isTri) {
                    const bp = (3000 + Math.random() * 9000) * loadFactor;
                    const v1 = 228 + gauss() * 2, v2 = 229 + gauss() * 2, v3 = 231 + gauss() * 2;
                    const pf = Math.min(0.98, Math.max(0.78, 0.91 + gauss() * 0.03));
                    const i1 = bp / (v1 * pf) * (1 + gauss() * 0.05);
                    const i2 = bp / (v2 * pf) * (1 + gauss() * 0.05);
                    const i3 = bp / (v3 * pf) * (1 + gauss() * 0.05);
                    const sinPF = Math.sin(Math.acos(pf));

                    data = {
                        voltage_l1_n: +v1.toFixed(1), voltage_l2_n: +v2.toFixed(1), voltage_l3_n: +v3.toFixed(1),
                        current_l1: +i1.toFixed(2), current_l2: +i2.toFixed(2), current_l3: +i3.toFixed(2),
                        power_w_l1: +(v1 * i1 * pf).toFixed(1), power_w_l2: +(v2 * i2 * pf).toFixed(1), power_w_l3: +(v3 * i3 * pf).toFixed(1),
                        power_w_total: +(v1 * i1 * pf + v2 * i2 * pf + v3 * i3 * pf).toFixed(1),
                        power_va_l1: +(v1 * i1).toFixed(1), power_va_l2: +(v2 * i2).toFixed(1), power_va_l3: +(v3 * i3).toFixed(1),
                        power_var_l1: +(v1 * i1 * sinPF).toFixed(1), power_var_l2: +(v2 * i2 * sinPF).toFixed(1), power_var_l3: +(v3 * i3 * sinPF).toFixed(1),
                        power_factor_l1: +pf.toFixed(3), power_factor_l2: +pf.toFixed(3), power_factor_l3: +pf.toFixed(3),
                        power_factor: +pf.toFixed(3),
                        frequency_hz: +(50 + gauss() * 0.05).toFixed(2),
                        energy_kwh_total: +(1000 + Math.random() * 49000).toFixed(1),
                    };
                } else {
                    const bp = (500 + Math.random() * 2000) * loadFactor;
                    const v = 230 + gauss() * 2;
                    const pf = Math.min(0.99, Math.max(0.85, 0.95 + gauss() * 0.02));
                    const ci = bp / (v * pf);
                    const sinPF = Math.sin(Math.acos(pf));

                    data = {
                        voltage_l1_n: +v.toFixed(1),
                        current_l1: +ci.toFixed(2),
                        power_w_l1: +bp.toFixed(1), power_w_total: +bp.toFixed(1),
                        power_va_l1: +(v * ci).toFixed(1),
                        power_var_l1: +(v * ci * sinPF).toFixed(1),
                        power_factor_l1: +pf.toFixed(3), power_factor: +pf.toFixed(3),
                        frequency_hz: +(50 + gauss() * 0.05).toFixed(2),
                        energy_kwh_total: +(100 + Math.random() * 4900).toFixed(1),
                    };
                }

                await client.query(
                    `INSERT INTO telemetry (
                        time, device_id, device_type,
                        voltage_l1_n, voltage_l2_n, voltage_l3_n,
                        current_l1, current_l2, current_l3,
                        power_w_l1, power_w_l2, power_w_l3, power_w_total,
                        power_va_l1, power_va_l2, power_va_l3,
                        power_var_l1, power_var_l2, power_var_l3,
                        power_factor, power_factor_l1, power_factor_l2, power_factor_l3,
                        frequency_hz, energy_kwh_total, raw_data
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                        $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
                    )`,
                    [
                        ts.toISOString(), device.id, device.device_type,
                        data.voltage_l1_n || null, data.voltage_l2_n || null, data.voltage_l3_n || null,
                        data.current_l1 || null, data.current_l2 || null, data.current_l3 || null,
                        data.power_w_l1 || null, data.power_w_l2 || null, data.power_w_l3 || null, data.power_w_total || null,
                        data.power_va_l1 || null, data.power_va_l2 || null, data.power_va_l3 || null,
                        data.power_var_l1 || null, data.power_var_l2 || null, data.power_var_l3 || null,
                        data.power_factor || null, data.power_factor_l1 || null, data.power_factor_l2 || null, data.power_factor_l3 || null,
                        data.frequency_hz || null, data.energy_kwh_total || null, JSON.stringify(data)
                    ]
                );

                deviceReadings++;
                totalInserted++;
            }

            // Update realtime cache with latest reading
            const latestData = {
                voltage_l1_n: isTri ? 229.5 : 230.1,
                voltage_l2_n: isTri ? 230.2 : null,
                voltage_l3_n: isTri ? 231.0 : null,
                current_l1: isTri ? 28.5 : 8.2,
                current_l2: isTri ? 27.8 : null,
                current_l3: isTri ? 29.1 : null,
                power_w_total: isTri ? (5500 + Math.random() * 4000) : (800 + Math.random() * 500),
                power_factor: isTri ? 0.92 : 0.96,
                frequency_hz: 50.01,
                energy_kwh_total: isTri ? 12500 : 2100,
            };

            await client.query(
                `INSERT INTO telemetry_realtime (device_id, device_type, data, last_updated)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (device_id)
                 DO UPDATE SET data = $3, device_type = $2, last_updated = NOW()`,
                [device.id, device.device_type, JSON.stringify(latestData)]
            );

            console.log(`   ✓ ${device.name}: ${deviceReadings} readings`);
        }

        await client.query('COMMIT');
        console.log(`\n[4] ✅ Done! ${totalInserted} total telemetry readings inserted.`);
        console.log(`    Open http://localhost:5173 and navigate to the factory dashboard!`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error:', err.message);
    } finally {
        client.release();
        process.exit(0);
    }
}

main();
