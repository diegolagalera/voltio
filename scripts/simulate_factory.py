#!/usr/bin/env python3
"""
FPSaver — Full Factory MQTT Simulator v3
Simulates a Raspberry Pi with dual-mode telemetry:
  - REALTIME: publishes to /realtime every 5 sec (WebSocket only, not stored)
  - BATCH:    publishes to /telemetry every 5 min (stored in DB, with ACK)

Usage:
    python3 scripts/simulate_factory.py                 # Dual-mode (realtime + batch)
    python3 scripts/simulate_factory.py --batch-only     # Only batch every 5 min
    python3 scripts/simulate_factory.py --historical     # Insert 48h + live
"""

import json
import math
import random
import time
import sys
import argparse
import os
import requests
import uuid
import threading
from datetime import datetime, timedelta, timezone

# ── Config ──
API_BASE = "http://localhost:3000/api"
FACTORY_ID = "91ddc8de-a84e-4d98-88ef-95b5a78747a2"
MQTT_HOST = "localhost"
MQTT_PORT = 1883

# ── Devices to simulate ──
SIMULATED_DEVICES = [
    {"name": "Contador General", "device_type": "trifasica", "model": "EM340",
     "profile": "master", "base_power": 45000, "noise": 0.05},
    {"name": "Compresor 1", "device_type": "trifasica", "model": "EM340",
     "profile": "compressor", "base_power": 11000, "noise": 0.08},
    {"name": "Compresor 2", "device_type": "trifasica", "model": "EM340",
     "profile": "compressor", "base_power": 7500, "noise": 0.08},
    {"name": "Horno Industrial", "device_type": "trifasica", "model": "EM340",
     "profile": "oven", "base_power": 15000, "noise": 0.06},
    {"name": "CNC Fresadora", "device_type": "trifasica", "model": "EM340",
     "profile": "cnc", "base_power": 8500, "noise": 0.12},
    {"name": "Prensa Hidráulica", "device_type": "trifasica", "model": "EM340",
     "profile": "press", "base_power": 5500, "noise": 0.15},
    {"name": "Iluminación Nave", "device_type": "monofasica", "model": "EM111",
     "profile": "lighting_industrial", "base_power": 3200, "noise": 0.03},
    {"name": "Iluminación Oficinas", "device_type": "monofasica", "model": "EM111",
     "profile": "lighting_office", "base_power": 1800, "noise": 0.02},
    {"name": "HVAC Oficinas", "device_type": "monofasica", "model": "EM111",
     "profile": "hvac", "base_power": 4500, "noise": 0.10},
]


# ══════════════════════════════════════════════════
#  LOAD PROFILES
# ══════════════════════════════════════════════════

def get_load_factor(profile, hour, minute=0, weekday=0):
    t = hour + minute / 60.0
    is_weekend = weekday >= 5

    if profile == "master":
        if is_weekend:
            return 0.12 + 0.05 * math.sin(math.pi * t / 24)
        if 7 <= t < 18:
            return 0.50 + 0.35 * math.sin(math.pi * (t - 7) / 11)
        elif 6 <= t < 7:
            return 0.15 + 0.35 * (t - 6)
        elif 18 <= t < 20:
            return 0.50 - 0.35 * (t - 18) / 2
        else:
            return 0.10 + 0.03 * random.random()
    elif profile == "compressor":
        if is_weekend or not (7 <= t < 18):
            return 0.05 * random.random()
        cycle = math.sin(t * math.pi * 4) * 0.3
        return max(0.1, 0.6 + cycle + 0.1 * random.random())
    elif profile == "oven":
        if is_weekend:
            return 0.02
        if 7 <= t < 8:
            return 0.1 + 0.85 * (t - 7)
        elif 8 <= t < 16:
            return 0.90 + 0.05 * math.sin(t * 2)
        elif 16 <= t < 17:
            return 0.90 - 0.80 * (t - 16)
        else:
            return 0.02 + 0.02 * random.random()
    elif profile == "cnc":
        if is_weekend or not (7 <= t < 18):
            return 0.03
        return (0.5 + 0.4 * random.random()) if random.random() < 0.70 else 0.08
    elif profile == "press":
        if is_weekend or not (7 <= t < 17):
            return 0.02
        return (0.7 + 0.25 * random.random()) if random.random() < 0.40 else 0.10
    elif profile == "lighting_industrial":
        if is_weekend:
            return 0.10
        return 0.85 + 0.10 * random.random() if 6 <= t < 20 else 0.10
    elif profile == "lighting_office":
        if is_weekend:
            return 0.02
        if 8 <= t < 19:
            return 0.80 + 0.15 * random.random()
        elif 7 <= t < 8:
            return 0.3 + 0.5 * (t - 7)
        elif 19 <= t < 20:
            return 0.80 - 0.7 * (t - 19)
        else:
            return 0.02
    elif profile == "hvac":
        if is_weekend:
            return 0.05
        month = datetime.now().month
        season_factor = 0.8 if month in (6, 7, 8, 12, 1, 2) else 0.5
        return season_factor * (0.6 + 0.3 * random.random()) if 7 <= t < 19 else 0.05
    return 0.5


# ══════════════════════════════════════════════════
#  DATA GENERATORS
# ══════════════════════════════════════════════════

energy_accumulators = {}

def generate_trifasica(device, hour, minute=0, weekday=0, dt_seconds=5):
    profile, base, noise, dev_name = device["profile"], device["base_power"], device["noise"], device["name"]
    load = get_load_factor(profile, hour, minute, weekday)
    power_total = max(50, base * load * (1 + random.gauss(0, noise)))

    v1, v2, v3 = 229 + random.gauss(0, 1.5), 230 + random.gauss(0, 1.5), 231 + random.gauss(0, 1.5)
    base_pf = 0.92 if load > 0.5 else 0.85 if load > 0.2 else 0.72
    pf1 = min(0.99, max(0.65, base_pf + random.gauss(0, 0.02)))
    pf2 = min(0.99, max(0.65, base_pf + random.gauss(0, 0.02)))
    pf3 = min(0.99, max(0.65, base_pf + random.gauss(0, 0.02)))

    split = [0.33 + random.gauss(0, 0.02) for _ in range(3)]
    ts = sum(split)
    split = [s / ts for s in split]
    p1, p2, p3 = power_total * split[0], power_total * split[1], power_total * split[2]
    i1, i2, i3 = p1 / (v1 * pf1), p2 / (v2 * pf2), p3 / (v3 * pf3)

    if dev_name not in energy_accumulators:
        energy_accumulators[dev_name] = random.uniform(5000, 80000)
        # Initialize per-phase energy proportionally
        energy_accumulators[dev_name + "_l1"] = energy_accumulators[dev_name] * split[0]
        energy_accumulators[dev_name + "_l2"] = energy_accumulators[dev_name] * split[1]
        energy_accumulators[dev_name + "_l3"] = energy_accumulators[dev_name] * split[2]
    energy_accumulators[dev_name] += (power_total / 1000) * (dt_seconds / 3600)
    # Per-phase energy: each phase accumulates based on its power contribution
    energy_accumulators[dev_name + "_l1"] += (p1 / 1000) * (dt_seconds / 3600)
    energy_accumulators[dev_name + "_l2"] += (p2 / 1000) * (dt_seconds / 3600)
    energy_accumulators[dev_name + "_l3"] += (p3 / 1000) * (dt_seconds / 3600)

    va1, va2, va3 = v1 * i1, v2 * i2, v3 * i3
    var1 = va1 * math.sin(math.acos(pf1))
    var2 = va2 * math.sin(math.acos(pf2))
    var3 = va3 * math.sin(math.acos(pf3))

    pf_avg = (pf1 + pf2 + pf3) / 3
    return {
        "voltage_l1_n": round(v1, 1), "voltage_l2_n": round(v2, 1), "voltage_l3_n": round(v3, 1),
        "voltage_l1_l2": round((v1+v2)*math.sqrt(3)/2, 1), "voltage_l2_l3": round((v2+v3)*math.sqrt(3)/2, 1),
        "voltage_l3_l1": round((v3+v1)*math.sqrt(3)/2, 1),
        "current_l1": round(i1, 2), "current_l2": round(i2, 2), "current_l3": round(i3, 2),
        "power_w_l1": round(p1, 1), "power_w_l2": round(p2, 1), "power_w_l3": round(p3, 1),
        "power_w_total": round(power_total, 1),
        "power_va_l1": round(va1, 1), "power_va_l2": round(va2, 1), "power_va_l3": round(va3, 1),
        "power_va_total": round(va1 + va2 + va3, 1),
        "power_var_l1": round(var1, 1), "power_var_l2": round(var2, 1), "power_var_l3": round(var3, 1),
        "power_var_total": round(var1 + var2 + var3, 1),
        "power_factor_l1": round(pf1, 3), "power_factor_l2": round(pf2, 3), "power_factor_l3": round(pf3, 3),
        "power_factor": round(pf_avg, 3),
        "frequency_hz": round(50 + random.gauss(0, 0.04), 2),
        "energy_kwh_total": round(energy_accumulators[dev_name], 2),
        "energy_kwh_l1": round(energy_accumulators[dev_name + "_l1"], 2),
        "energy_kwh_l2": round(energy_accumulators[dev_name + "_l2"], 2),
        "energy_kwh_l3": round(energy_accumulators[dev_name + "_l3"], 2),
        "energy_kvarh_total": round(energy_accumulators[dev_name] * 0.3, 2),
        "demand_w": round(power_total, 1), "demand_w_max": round(base * 0.95, 1),
    }


def generate_monofasica(device, hour, minute=0, weekday=0, dt_seconds=5):
    profile, base, noise, dev_name = device["profile"], device["base_power"], device["noise"], device["name"]
    load = get_load_factor(profile, hour, minute, weekday)
    power = max(10, base * load * (1 + random.gauss(0, noise)))

    voltage = 230 + random.gauss(0, 1.5)
    pf = min(0.99, max(0.80, 0.95 + random.gauss(0, 0.02)))
    current = power / (voltage * pf)

    if dev_name not in energy_accumulators:
        energy_accumulators[dev_name] = random.uniform(500, 10000)
    energy_accumulators[dev_name] += (power / 1000) * (dt_seconds / 3600)

    return {
        "voltage_l1_n": round(voltage, 1), "current_l1": round(current, 2),
        "power_w_l1": round(power, 1),
        "power_w_total": round(power, 1),
        "power_va_total": round(voltage * current, 1),
        "power_var_total": round(voltage * current * math.sin(math.acos(pf)), 1),
        "power_factor": round(pf, 3),
        "frequency_hz": round(50 + random.gauss(0, 0.04), 2),
        "energy_kwh_total": round(energy_accumulators[dev_name], 2),
        "energy_kwh_l1": round(energy_accumulators[dev_name], 2),
        "demand_w": round(power, 1),
        "demand_w_max": round(base * 0.95, 1),
    }


def generate_reading(dev, h, m, wd, dt):
    if dev["device_type"] == "trifasica":
        return generate_trifasica(dev, h, m, wd, dt)
    return generate_monofasica(dev, h, m, wd, dt)


# ══════════════════════════════════════════════════
#  DEVICE PROVISIONING
# ══════════════════════════════════════════════════

def ensure_devices(token, factory_id):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    r = requests.get(f"{API_BASE}/factories/{factory_id}/devices", headers=headers)
    existing = {d["name"]: d["id"] for d in r.json().get("data", [])}
    device_map = {}

    for idx, dev in enumerate(SIMULATED_DEVICES):
        if dev["name"] in existing:
            device_map[dev["name"]] = existing[dev["name"]]
            print(f"   ✓ {dev['name']} → {existing[dev['name']][:8]}...")
        else:
            payload = {
                "name": dev["name"], "device_type": dev["device_type"],
                "model": dev["model"], "modbus_address": idx + 10,
                "serial_number": f"SIM-{idx+1:03d}",
                "host": f"192.168.10.{idx+11}", "port": 502,
            }
            r = requests.post(f"{API_BASE}/factories/{factory_id}/devices", headers=headers, json=payload)
            if r.status_code == 201:
                did = r.json()["data"]["id"]
                device_map[dev["name"]] = did
                print(f"   + Created {dev['name']} → {did[:8]}...")
            else:
                print(f"   ✗ Failed: {dev['name']}: {r.text[:80]}")
    return device_map


# ══════════════════════════════════════════════════
#  HISTORICAL DATA
# ══════════════════════════════════════════════════

def generate_historical(token, device_map, hours=48):
    print(f"\n[HISTORICAL] Generating {hours}h of data (every 5 min)...")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    now = datetime.now(timezone.utc)
    total = 0

    for dev in SIMULATED_DEVICES:
        dev_name, dev_id = dev["name"], device_map.get(dev["name"])
        if not dev_id:
            continue
        readings = []
        for step in range(hours * 12):  # 12 readings/hour (every 5 min)
            ts = now - timedelta(minutes=step * 5)
            data = generate_reading(dev, ts.hour, ts.minute, ts.weekday(), 300)
            readings.append({
                "factory_id": FACTORY_ID, "device_id": dev_id,
                "device_type": dev["device_type"],
                "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "data": data,
            })
        for i in range(0, len(readings), 50):
            batch = readings[i:i+50]
            r = requests.post(f"{API_BASE}/telemetry/batch", headers=headers, json={"readings": batch})
            if r.status_code != 201:
                print(f"   ✗ Batch failed for {dev_name}: {r.text[:80]}")
                break
            total += len(batch)
        print(f"   ✓ {dev_name}: {len(readings)} readings")
    print(f"   Total: {total} readings\n")


# ══════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════

start_time = time.time()

# ACK tracking
pending_acks = {}
ack_lock = threading.Lock()


def on_ack(client, userdata, msg):
    """Handle ACK from server."""
    try:
        data = json.loads(msg.payload.decode())
        batch_id = data.get("batch_id")
        count = data.get("readings_stored", 0)
        if batch_id:
            with ack_lock:
                pending_acks.pop(batch_id, None)
            print(f"   ✅ ACK: batch {batch_id[:8]} confirmed ({count} readings stored)")
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(description="FPSaver Factory Simulator v3")
    parser.add_argument("--interval", type=int, default=5, help="Seconds between realtime readings (default: 5)")
    parser.add_argument("--batch-interval", type=int, default=300, help="Seconds between batch sends (default: 300)")
    parser.add_argument("--historical", action="store_true", help="Generate 48h of historical data first")
    parser.add_argument("--hours", type=int, default=48, help="Hours of historical data")
    parser.add_argument("--batch-only", action="store_true", help="Only batch mode (no realtime)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Print full JSON payload for each device reading")
    args = parser.parse_args()

    print("=" * 60)
    print("  FPSaver Factory Simulator v3.0")
    print("  Dual-mode: REALTIME (WebSocket) + BATCH (DB)")
    print("=" * 60)

    # Auth
    print("\n[1] Authenticating...")
    r = requests.post(f"{API_BASE}/auth/login", json={"email": "admin@fpsaver.com", "password": "SuperAdmin2026!"})
    token = r.json()["data"]["accessToken"]
    print("   ✓ Logged in")

    # Devices
    print("\n[2] Provisioning devices...")
    device_map = ensure_devices(token, FACTORY_ID)
    print(f"   Total: {len(device_map)} devices")

    # Historical
    if args.historical:
        generate_historical(token, device_map, args.hours)

    # MQTT
    mqtt_client = None
    try:
        import paho.mqtt.client as mqtt
        mqtt_client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"simulator_{FACTORY_ID[:8]}",
        )
        mqtt_client.username_pw_set("backend_service", "backend_service_pass")
        mqtt_client.on_message = on_ack
        mqtt_client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
        mqtt_client.subscribe(f"factory/{FACTORY_ID}/ack", qos=1)
        mqtt_client.loop_start()
        print(f"\n[3] MQTT connected ✓ (subscribed to /ack)")
        use_mqtt = True
    except Exception as e:
        print(f"\n[3] MQTT unavailable ({e})")
        use_mqtt = False

    # Live simulation
    rt_sec = args.interval
    batch_sec = args.batch_interval
    batch_only = args.batch_only

    print(f"\n[4] Running {'BATCH ONLY' if batch_only else 'DUAL MODE'}:")
    print(f"    Realtime: every {rt_sec}s → /realtime (WebSocket only)")
    print(f"    Batch:    every {batch_sec}s → /telemetry (DB + ACK)")
    print(f"    Press Ctrl+C to stop\n")

    TABLE_HEADER = [
        "┌────────────────────────────┬──────────┬──────────┬──────────┬──────────┐",
        "│ Device                     │ Power(W) │ PF       │ V (L1)   │ kWh      │",
        "├────────────────────────────┼──────────┼──────────┼──────────┼──────────┤",
    ]
    TABLE_FOOTER = "└────────────────────────────┴──────────┴──────────┴──────────┴──────────┘"

    cycle = 0
    last_batch_time = time.time()
    batch_accumulator = []

    try:
        while True:
            now = datetime.now(timezone.utc)
            h, m, wd = now.hour, now.minute, now.weekday()

            readings = []
            for dev in SIMULATED_DEVICES:
                dev_name = dev["name"]
                dev_id = device_map.get(dev_name)
                if not dev_id:
                    continue
                data = generate_reading(dev, h, m, wd, rt_sec)
                readings.append({
                    "factory_id": FACTORY_ID, "device_id": dev_id,
                    "device_type": dev["device_type"], "device_name": dev_name,
                    "timestamp": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "data": data,
                })

            # Accumulate for batch
            batch_accumulator.extend(readings)

            # ── REALTIME publish (WebSocket only) ──
            if use_mqtt and not batch_only:
                topic_rt = f"factory/{FACTORY_ID}/realtime"
                mqtt_client.publish(topic_rt, json.dumps(readings), qos=0)

            # ── BATCH publish (every batch_sec) ──
            elapsed = time.time() - last_batch_time
            if elapsed >= batch_sec:
                # Aggregate: keep only last reading per device
                latest = {}
                for r in batch_accumulator:
                    latest[r["device_id"]] = r
                aggregated = list(latest.values())

                batch_id = str(uuid.uuid4())
                if use_mqtt:
                    topic_batch = f"factory/{FACTORY_ID}/telemetry"
                    payload = json.dumps({"batch_id": batch_id, "readings": aggregated})
                    mqtt_client.publish(topic_batch, payload, qos=1)
                    with ack_lock:
                        pending_acks[batch_id] = time.time()

                batch_accumulator.clear()
                last_batch_time = time.time()

                with ack_lock:
                    pending_count = len(pending_acks)
                print(f"\n   📦 BATCH {batch_id[:8]}: {len(aggregated)} devices → /telemetry (pending ACKs: {pending_count})")

            # Display
            if cycle % 10 == 0:
                mode_str = "RT" if not batch_only else "BATCH"
                next_batch = max(0, batch_sec - (time.time() - last_batch_time))
                print(f"\n  ⏱  {now.strftime('%H:%M:%S')} UTC | Cycle #{cycle} | {mode_str} | Next batch: {int(next_batch)}s")
                if args.verbose:
                    # Verbose: full JSON per device
                    for r in readings:
                        print(f"\n  📡 {r['device_name']}:")
                        print(json.dumps(r['data'], indent=4, default=str))
                else:
                    for line in TABLE_HEADER:
                        print(line)
                    for r in readings:
                        d = r["data"]
                        print(f"│ {r['device_name']:<26} │ {d.get('power_w_total',0):>8.0f} │ "
                              f"{d.get('power_factor',0):>8.3f} │ {d.get('voltage_l1_n',0):>8.1f} │ "
                              f"{d.get('energy_kwh_total',0):>8.1f} │")
                    print(TABLE_FOOTER)
            else:
                total_w = sum(r["data"].get("power_w_total", 0) for r in readings)
                next_batch = max(0, batch_sec - (time.time() - last_batch_time))
                sys.stdout.write(f"\r  ⏱  {now.strftime('%H:%M:%S')} | #{cycle} | "
                                 f"{len(readings)} devs | {total_w:.0f}W | "
                                 f"Batch in {int(next_batch)}s")
                sys.stdout.flush()

            cycle += 1
            time.sleep(rt_sec)

    except KeyboardInterrupt:
        print(f"\n\n[DONE] Stopped after {cycle} cycles ({cycle * rt_sec}s)")
        with ack_lock:
            if pending_acks:
                print(f"   ⚠ {len(pending_acks)} unconfirmed batches")
        if mqtt_client:
            mqtt_client.loop_stop()
            mqtt_client.disconnect()


if __name__ == "__main__":
    main()
