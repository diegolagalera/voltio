#!/usr/bin/env python3
"""
FPSaver — Create devices + Simulate telemetry data
Creates 4 devices in the factory, then inserts realistic telemetry data.
"""
import requests
import json
import random
import math
import sys
from datetime import datetime, timedelta

BASE = "http://localhost:3000/api"

# Login as SuperAdmin
print("[1] Logging in as SuperAdmin...")
r = requests.post(f"{BASE}/auth/login", json={"email": "admin@fpsaver.com", "password": "SuperAdmin2026!"})
token = r.json()["data"]["accessToken"]
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# Get factory
print("[2] Getting factory...")
r = requests.get(f"{BASE}/superadmin/factories", headers=headers)
factories = r.json()["data"]
if not factories:
    print("   No factories found! Create one first.")
    sys.exit(1)
factory = factories[0]
factory_id = factory["id"]
print(f"   Factory: {factory['name']} ({factory_id})")

# Check existing devices
r = requests.get(f"{BASE}/factories/{factory_id}/devices", headers=headers)
existing_devices = r.json()["data"]
print(f"   Existing devices: {len(existing_devices)}")

# Create devices if none exist
if len(existing_devices) == 0:
    print("[3] Creating devices...")
    devices_to_create = [
        {"name": "Compresor 1", "device_type": "trifasica", "modbus_address": 1, "model": "EM340", "serial_number": "SN-CG-001"},
        {"name": "Compresor 2", "device_type": "trifasica", "modbus_address": 2, "model": "EM340", "serial_number": "SN-CG-002"},
        {"name": "Horno Industrial", "device_type": "trifasica", "modbus_address": 3, "model": "EM340", "serial_number": "SN-CG-003"},
        {"name": "Iluminación Nave", "device_type": "monofasica", "modbus_address": 4, "model": "EM111", "serial_number": "SN-CG-004"},
    ]
    for d in devices_to_create:
        r = requests.post(f"{BASE}/factories/{factory_id}/devices", headers=headers, json=d)
        if r.status_code == 201:
            print(f"   ✓ Created: {d['name']} ({r.json()['data']['id'][:8]}...)")
        else:
            print(f"   ✗ Failed: {d['name']} - {r.text[:100]}")

    # Re-fetch devices  
    r = requests.get(f"{BASE}/factories/{factory_id}/devices", headers=headers)
    existing_devices = r.json()["data"]
else:
    print("[3] Devices already exist, skipping creation.")

devices = existing_devices
print(f"   Total devices: {len(devices)}")

# Simulate telemetry data for the past 48 hours
print("[4] Generating simulated telemetry (48h of data)...")

def generate_trifasica_reading(hour_of_day, noise=0.1):
    """Generate realistic 3-phase meter readings based on time of day"""
    # Industrial load profile: higher during work hours
    if 6 <= hour_of_day < 22:
        load_factor = 0.6 + 0.3 * math.sin(math.pi * (hour_of_day - 6) / 16)
    else:
        load_factor = 0.15 + 0.05 * random.random()
    
    base_power = random.uniform(3000, 15000) * load_factor
    
    # Voltages (230V L-N nominal for each phase)
    v1 = 228 + random.gauss(0, 2)
    v2 = 229 + random.gauss(0, 2)
    v3 = 231 + random.gauss(0, 2)
    
    # Currents
    i1 = base_power / (v1 * 0.85) * (1 + random.gauss(0, noise))
    i2 = base_power / (v2 * 0.87) * (1 + random.gauss(0, noise))
    i3 = base_power / (v3 * 0.83) * (1 + random.gauss(0, noise))
    
    # Power factors
    pf1 = min(0.99, max(0.75, 0.92 + random.gauss(0, 0.03)))
    pf2 = min(0.99, max(0.75, 0.91 + random.gauss(0, 0.03)))
    pf3 = min(0.99, max(0.75, 0.90 + random.gauss(0, 0.03)))
    
    # Active power per phase
    p1 = v1 * i1 * pf1
    p2 = v2 * i2 * pf2
    p3 = v3 * i3 * pf3
    
    return {
        "voltage_l1_n": round(v1, 1), "voltage_l2_n": round(v2, 1), "voltage_l3_n": round(v3, 1),
        "current_l1": round(i1, 2), "current_l2": round(i2, 2), "current_l3": round(i3, 2),
        "power_w_l1": round(p1, 1), "power_w_l2": round(p2, 1), "power_w_l3": round(p3, 1),
        "power_w_total": round(p1 + p2 + p3, 1),
        "power_va_l1": round(v1 * i1, 1), "power_va_l2": round(v2 * i2, 1), "power_va_l3": round(v3 * i3, 1),
        "power_var_l1": round(v1 * i1 * math.sin(math.acos(pf1)), 1),
        "power_var_l2": round(v2 * i2 * math.sin(math.acos(pf2)), 1),
        "power_var_l3": round(v3 * i3 * math.sin(math.acos(pf3)), 1),
        "power_factor_l1": round(pf1, 3), "power_factor_l2": round(pf2, 3), "power_factor_l3": round(pf3, 3),
        "power_factor": round((pf1 + pf2 + pf3) / 3, 3),
        "frequency_hz": round(50 + random.gauss(0, 0.05), 2),
        "energy_kwh_total": round(random.uniform(1000, 50000), 1),
    }

def generate_monofasica_reading(hour_of_day):
    """Generate realistic single-phase meter readings"""
    if 6 <= hour_of_day < 22:
        load_factor = 0.5 + 0.4 * math.sin(math.pi * (hour_of_day - 6) / 16)
    else:
        load_factor = 0.1
    
    voltage = 230 + random.gauss(0, 2)
    power = random.uniform(500, 3000) * load_factor
    pf = min(0.99, max(0.8, 0.95 + random.gauss(0, 0.02)))
    current = power / (voltage * pf)
    
    return {
        "voltage": round(voltage, 1),
        "current": round(current, 2),
        "power_w": round(power, 1),
        "power_va": round(voltage * current, 1),
        "power_var": round(voltage * current * math.sin(math.acos(pf)), 1),
        "power_factor": round(pf, 3),
        "frequency_hz": round(50 + random.gauss(0, 0.05), 2),
        "energy_kwh_total": round(random.uniform(100, 5000), 1),
    }

# Insert telemetry via REST endpoint
now = datetime.utcnow()
total_readings = 0
batch_size = 20

for device in devices:
    device_id = device["id"]
    device_type = device["device_type"]
    print(f"   Generating data for {device['name']} ({device_type})...")
    
    readings = []
    for h in range(48 * 12):  # Every 5 minutes for 48 hours = 576 readings
        ts = now - timedelta(minutes=h * 5)
        hour_of_day = ts.hour
        
        if device_type == "trifasica":
            data = generate_trifasica_reading(hour_of_day)
        else:
            data = generate_monofasica_reading(hour_of_day)
        
        readings.append({
            "factory_id": factory_id,
            "device_id": device_id,
            "device_type": device_type,
            "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "data": data,
        })
    
    # Insert in batches
    for i in range(0, len(readings), batch_size):
        batch = readings[i:i + batch_size]
        r = requests.post(f"{BASE}/telemetry/batch", headers=headers, json={"readings": batch})
        if r.status_code != 201:
            print(f"      ✗ Batch {i//batch_size} failed: {r.text[:80]}")
            break
        total_readings += len(batch)
    
    print(f"      ✓ {len(readings)} readings inserted")

print(f"\n[5] Done! {total_readings} total telemetry readings inserted.")
print(f"    Factory: {factory['name']}")
print(f"    Devices: {len(devices)}")
print(f"    Period: {(now - timedelta(hours=48)).strftime('%Y-%m-%d %H:%M')} → {now.strftime('%Y-%m-%d %H:%M')}")
print(f"\n    Now login at http://localhost:5173 and check the factory dashboard!")
