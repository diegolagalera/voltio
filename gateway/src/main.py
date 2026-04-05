#!/usr/bin/env python3
"""
Voltio Gateway v2.0 — Multi-Meter Agent
Industrial energy meter gateway for Carlo Gavazzi + Eastron meters.

Architecture:
  - ALWAYS: Read meters every READ_INTERVAL, aggregate every BATCH_INTERVAL → batch to /telemetry
  - ON DEMAND: When user opens dashboard → /realtime every READ_INTERVAL (MQTT)
  - OFFLINE: Store batches in SQLite → flush on reconnect → delete ONLY after valid ACK
  - AUTO-DISCOVERY: Scan network on boot to find new meters automatically
  - GATING: Only confirmed devices (real UUID) publish telemetry
"""

import json
import time
import signal
import threading
import logging
import os
import sys
from datetime import datetime, timezone

# Local modules
from modbus_reader import ModbusReader, close_all_clients
from data_processor import DataProcessor
from network_scanner import NetworkScanner
from data_buffer import DataBuffer

# ── Logging ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")

# ── Config ──
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "config.json")
REGISTERS_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "registers.json")

with open(CONFIG_PATH) as f:
    config = json.load(f)

with open(REGISTERS_PATH) as f:
    register_map = json.load(f)

FACTORY_ID = config["factory_id"]
MQTT_CFG = config["mqtt"]
NETWORK_CFG = config.get("network", {})
INTERVALS = config.get("intervals", {})

BATCH_INTERVAL = INTERVALS.get("batch_seconds", 300)
REALTIME_INTERVAL = INTERVALS.get("realtime_seconds", 5)
READ_INTERVAL = INTERVALS.get("read_seconds", 5)
FLUSH_INTERVAL = INTERVALS.get("flush_seconds", 30)
SCAN_INTERVAL = INTERVALS.get("scan_interval_hours", 24) * 3600  # Convert to seconds
BATCH_MODE = INTERVALS.get("batch_mode", "average")  # 'average' or 'last'
PID_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "gateway.pid")

# ── Core Components ──
modbus_reader = ModbusReader(timeout=3, retries=2)
data_processor = DataProcessor(register_map)
scanner = NetworkScanner(
    modbus_reader=modbus_reader,
    scan_range=(
        NETWORK_CFG.get("scan_range_start", "192.168.1.1"),
        NETWORK_CFG.get("scan_range_end", "192.168.1.254"),
    ),
    scan_port=NETWORK_CFG.get("scan_port", 502),
    scan_timeout=NETWORK_CFG.get("scan_timeout", 1),
)

# ── State ──
devices_lock = threading.Lock()
devices = list(config.get("devices", []))

realtime_active = threading.Event()
shutdown_event = threading.Event()

readings_accumulator = []
accumulator_lock = threading.Lock()

# ── Model → Register Type Mapping ──
# The backend uses schema types (trifasica/monofasica) but the gateway
# needs internal register map keys to select the correct Modbus protocol.
MODEL_TO_REGISTER_TYPE = {
    'SDM630MCT-V2': 'sdm630mct',   # Eastron: FC 04, Float32
    'SDM630MCT': 'sdm630mct',
    'SDM630': 'sdm630mct',
    'EM340': 'trifasica',           # Carlo Gavazzi: FC 03, INT
    'EM24': 'trifasica',
    'EM111': 'monofasica',
}


def resolve_device_type(device):
    """Resolve the internal register map key from model or device_type."""
    model = device.get('model', '')
    # Check model first (most specific)
    for key, reg_type in MODEL_TO_REGISTER_TYPE.items():
        if key.lower() in model.lower():
            return reg_type
    # Fallback to device_type (may be wrong for Eastron devices)
    return device.get('device_type', 'sdm630mct')


def is_confirmed(device):
    """Check if a device has been confirmed by the backend (has a real UUID)."""
    device_id = device.get('device_id', '')
    if not device_id:
        return False
    # Temporary IDs from auto-discovery start with 'auto_' or are placeholders
    if device_id.startswith('auto_') or device_id in ('DEVICE_UUID', ''):
        return False
    return True

# ── Buffer ──
buffer = DataBuffer(
    os.path.join(os.path.dirname(__file__), "..", "data", "buffer.db")
)

# ── MQTT ──
mqtt_client = None
mqtt_connect_count = 0


def setup_mqtt():
    """Connect to MQTT broker with TLS and authentication."""
    global mqtt_client
    import paho.mqtt.client as mqtt
    import ssl

    # Stable client_id = broker remembers us + queues QoS 1 messages while offline
    client = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"gw_{FACTORY_ID[:8]}",
        clean_session=False,  # Persistent session: broker queues messages while offline
    )

    # Auth
    client.username_pw_set(MQTT_CFG["username"], MQTT_CFG["password"])

    # TLS
    tls_cfg = MQTT_CFG.get("tls", {})
    if tls_cfg.get("enabled", False):
        ca_cert = tls_cfg.get("ca_cert", "./certs/ca.crt")
        if os.path.exists(ca_cert):
            client.tls_set(ca_certs=ca_cert, cert_reqs=ssl.CERT_REQUIRED)
        else:
            logger.warning(f"[MQTT] TLS CA cert not found: {ca_cert}, using insecure TLS")
            client.tls_set(cert_reqs=ssl.CERT_NONE)
            client.tls_insecure_set(True)

    # Callbacks
    client.on_connect = on_mqtt_connect
    client.on_disconnect = on_mqtt_disconnect
    client.on_message = on_mqtt_message

    # Auto-reconnect settings
    client.reconnect_delay_set(min_delay=1, max_delay=60)

    try:
        client.connect(MQTT_CFG["broker_host"], MQTT_CFG["broker_port"], keepalive=60)
        client.loop_start()
        mqtt_client = client
        return client
    except Exception as e:
        logger.error(f"[MQTT] Initial connection failed: {e}")
        logger.warning("[MQTT] Running in offline mode — will keep retrying in background")
        # Still store the client — paho auto-reconnects via loop_start()
        client.loop_start()
        mqtt_client = client
        return client


def on_mqtt_connect(client, userdata, flags, reason_code, properties=None):
    global mqtt_connect_count
    if reason_code == 0:
        mqtt_connect_count += 1
        first_time = mqtt_connect_count == 1
        logger.info(f"[MQTT] {'Connected' if first_time else 'RECONNECTED'} to broker")
        client.subscribe(f"factory/{FACTORY_ID}/commands", qos=1)
        client.subscribe(f"factory/{FACTORY_ID}/ack", qos=1)
        # Flush pending batches on every (re)connect
        threading.Thread(target=flush_pending_batches, daemon=True).start()
    else:
        logger.error(f"[MQTT] Connection failed: {reason_code}")


def on_mqtt_disconnect(client, userdata, flags, reason_code, properties=None):
    if reason_code != 0:
        logger.warning(f"[MQTT] Unexpected disconnect ({reason_code}), auto-reconnecting...")
    else:
        logger.info("[MQTT] Clean disconnect")


def on_mqtt_message(client, userdata, msg):
    """Route incoming MQTT messages."""
    topic = msg.topic
    try:
        payload = json.loads(msg.payload.decode())
    except Exception:
        return

    if topic.endswith("/ack"):
        handle_ack(payload)
    elif topic.endswith("/commands"):
        handle_command(payload)


# ── ACK Handler ──

def handle_ack(payload):
    """
    Server confirmed a batch was stored.
    Uses error classification to decide: delete batch or keep for retry.

    Error types from backend:
      - permanent: FK violation (device deleted), bad enum, schema mismatch
                   → No point retrying, delete the batch
      - transient: DB timeout, disk full, deadlock
                   → Keep in buffer, will retry on next flush
    """
    batch_id = payload.get("batch_id")
    status = payload.get("status")
    count = payload.get("readings_stored", 0)
    errors = payload.get("errors", 0)
    permanent_errors = payload.get("permanent_errors", 0)

    if not batch_id:
        logger.warning(f"[ACK] Missing batch_id in ACK: {payload}")
        return

    if errors == 0:
        # Clean success — all readings stored
        buffer.mark_confirmed(batch_id)
        logger.info(f"[ACK] Batch {batch_id[:8]} confirmed ({count} readings stored)")

    elif permanent_errors == errors:
        # ALL errors are permanent (device deleted, bad type, etc)
        # No point retrying — delete from buffer
        buffer.mark_confirmed(batch_id)
        failed = payload.get("failed_devices", [])
        device_ids = [f.get("device_id", "?")[:8] for f in failed] if failed else []
        logger.warning(
            f"[ACK] Batch {batch_id[:8]} discarded: {errors} permanent errors "
            f"(devices: {device_ids}). No retry — data is irrecoverable."
        )

    elif count > 0:
        # Partial success with some transient errors
        # Keep in buffer to retry (transient errors may resolve)
        logger.warning(
            f"[ACK] Batch {batch_id[:8]} partial: {count} stored, "
            f"{errors} errors ({permanent_errors} permanent, "
            f"{errors - permanent_errors} transient). Keeping for retry."
        )

    else:
        # Total failure — all transient → keep for retry
        logger.warning(
            f"[ACK] Batch {batch_id[:8]} failed: {errors} transient errors. "
            f"Keeping in buffer for retry."
        )


# ── Command Handler ──

def handle_command(payload):
    """Process commands from the backend."""
    action = payload.get("action")

    if action == "start_realtime":
        realtime_active.set()
        logger.info("[CMD] Realtime mode ACTIVATED")

    elif action == "stop_realtime":
        realtime_active.clear()
        logger.info("[CMD] Realtime mode DEACTIVATED")

    elif action == "scan_network":
        logger.info("[CMD] Network scan requested")
        threading.Thread(target=run_scan, daemon=True).start()

    elif action == "add_device":
        device_data = payload.get("device", {})
        new_host = device_data.get("host")
        new_id = device_data.get("device_id")

        with devices_lock:
            # Check if we have a temp auto-discovered device at this host
            replaced = False
            for i, d in enumerate(devices):
                if d.get("host") == new_host and not is_confirmed(d):
                    # Replace temp device with confirmed one (real UUID)
                    devices[i] = device_data
                    replaced = True
                    logger.info(
                        f"[CMD] Device CONFIRMED: {d.get('device_id')} → {new_id} "
                        f"({device_data.get('name')})"
                    )
                    break
            if not replaced:
                devices.append(device_data)
                logger.info(f"[CMD] Device added: {device_data.get('name')} ({new_id})")

        save_config()

    elif action == "remove_device":
        device_id = payload.get("device_id")
        with devices_lock:
            devices[:] = [d for d in devices if d.get("device_id") != device_id]
        save_config()
        logger.info(f"[CMD] Device removed: {device_id}")

    else:
        logger.warning(f"[CMD] Unknown action: {action}")


# ── Network Scan ──

def run_scan():
    """Execute network scan and publish results + auto-register new devices."""
    try:
        results = scanner.scan()

        # Auto-register new devices
        with devices_lock:
            known_ips = {d.get("host") for d in devices}

        new_devices = []
        for discovered in results:
            ip = discovered["ip_address"]
            if ip not in known_ips:
                new_device = {
                    "device_id": f"auto_{ip.replace('.', '_')}",
                    "name": f"{discovered['detected_model']} ({ip})",
                    "device_type": discovered.get("type", discovered["detected_type"]),
                    "detected_type": discovered["detected_type"],
                    "model": discovered["detected_model"],
                    "host": ip,
                    "port": discovered["port"],
                    "modbus_address": discovered["modbus_address"],
                }
                new_devices.append(new_device)
                logger.info(
                    f"[SCAN] New device discovered: {new_device['name']} "
                    f"at {ip} — {discovered['voltage_sample']}V"
                )

        if new_devices:
            with devices_lock:
                devices.extend(new_devices)
            save_config()
            logger.info(f"[SCAN] Auto-registered {len(new_devices)} new device(s)")

        # Publish discovery to server
        if mqtt_client and mqtt_client.is_connected():
            topic = f"factory/{FACTORY_ID}/discovery"
            message = scanner.format_discovery_message(FACTORY_ID, results)
            mqtt_client.publish(topic, json.dumps(message), qos=1)
            logger.info(
                f"[SCAN] Found {len(results)} devices, "
                f"published to {topic}"
            )

    except Exception as e:
        logger.error(f"[SCAN] Error: {e}")


# ── Meter Reading ──

def read_all_devices():
    """
    Read all active devices and return list of processed readings.
    Each reading is tagged with 'confirmed' flag to control telemetry publishing.
    """
    readings = []
    with devices_lock:
        active_devices = list(devices)

    for dev in active_devices:
        try:
            host = dev.get("host", "192.168.1.200")
            port = dev.get("port", 502)
            device_type = resolve_device_type(dev)  # Internal register map key
            modbus_address = dev.get("modbus_address", 1)
            confirmed = is_confirmed(dev)

            # Read raw registers (always read — even unconfirmed, for monitoring)
            raw_data = modbus_reader.read_device(
                host, port, modbus_address, device_type
            )

            if raw_data:
                telemetry = data_processor.process_to_telemetry(raw_data, device_type)

                if telemetry:
                    readings.append({
                        "device_id": dev.get("device_id"),
                        "device_type": dev.get("device_type", "trifasica"),  # DB schema type
                        "device_name": dev.get("name", "Unknown"),
                        "model": dev.get("model", "Unknown"),
                        "host": host,
                        "port": port,
                        "modbus_address": modbus_address,
                        "confirmed": confirmed,
                        "timestamp": datetime.now(timezone.utc).strftime(
                            "%Y-%m-%dT%H:%M:%SZ"
                        ),
                        "data": telemetry,
                    })
                else:
                    logger.warning(f"[READ] No valid data from {dev.get('name')}")
            else:
                logger.warning(f"[READ] Failed to read {dev.get('name')} at {host}")

        except Exception as e:
            logger.error(f"[READ] Error reading {dev.get('name')}: {e}")

    return readings


# ── Publishing ──

def publish_realtime(readings):
    """Publish confirmed devices to /realtime (QoS 0, fire-and-forget)."""
    if not mqtt_client or not mqtt_client.is_connected():
        return
    # Only publish confirmed devices
    confirmed_readings = [r for r in readings if r.get('confirmed', False)]
    if not confirmed_readings:
        return
    topic = f"factory/{FACTORY_ID}/realtime"
    payload = json.dumps(confirmed_readings)
    mqtt_client.publish(topic, payload, qos=0)
    logger.debug(f"[RT] Published {len(confirmed_readings)} confirmed readings")


def publish_batch(batch_readings):
    """
    Store batch in buffer → publish to /telemetry (QoS 1).
    Waits for ACK before clearing from buffer.
    """
    if not batch_readings:
        return

    batch_id = buffer.store(FACTORY_ID, batch_readings)

    if mqtt_client and mqtt_client.is_connected():
        topic = f"factory/{FACTORY_ID}/telemetry"
        payload = json.dumps({
            "batch_id": batch_id,
            "readings": batch_readings,
        })
        result = mqtt_client.publish(topic, payload, qos=1)
        if result.rc == 0:
            buffer.mark_sent(batch_id)
            logger.info(
                f"[BATCH] Published batch {batch_id[:8]} "
                f"({len(batch_readings)} readings, awaiting ACK)"
            )
        else:
            logger.warning(
                f"[BATCH] Publish failed (rc={result.rc}), "
                f"batch {batch_id[:8]} stays in buffer"
            )
    else:
        logger.warning(
            f"[BATCH] Offline — batch {batch_id[:8]} "
            f"buffered ({len(batch_readings)} readings)"
        )
        stats = buffer.get_stats()
        logger.info(f"[BUFFER] {stats}")


def flush_pending_batches():
    """Re-send any pending/stale batches (called on reconnect)."""
    time.sleep(2)
    buffer.reset_stale_sent(max_age_seconds=120)
    pending = buffer.get_pending(limit=20)

    if not pending:
        return

    logger.info(f"[FLUSH] Sending {len(pending)} pending batches...")

    for batch in pending:
        if shutdown_event.is_set():
            break
        if not mqtt_client or not mqtt_client.is_connected():
            break

        topic = f"factory/{batch['factory_id']}/telemetry"
        payload = json.dumps({
            "batch_id": batch["batch_id"],
            "readings": batch["readings"],
        })
        result = mqtt_client.publish(topic, payload, qos=1)
        if result.rc == 0:
            buffer.mark_sent(batch["batch_id"])
            logger.info(f"[FLUSH] Resent batch {batch['batch_id'][:8]}")
        time.sleep(0.5)


# ── Config Persistence ──

def save_config():
    """Persist current device list to config.json (atomic write to prevent corruption)."""
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
        with devices_lock:
            cfg["devices"] = list(devices)

        # Atomic write: write to temp file first, then rename
        tmp_path = CONFIG_PATH + ".tmp"
        with open(tmp_path, "w") as f:
            json.dump(cfg, f, indent=4)
        os.replace(tmp_path, CONFIG_PATH)  # Atomic on POSIX
        logger.info("[CONFIG] Saved")
    except Exception as e:
        logger.error(f"[CONFIG] Save error: {e}")
        # Clean up temp file if it exists
        try:
            tmp_path = CONFIG_PATH + ".tmp"
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass


# ── Main Loops ──

def reader_loop():
    """
    Read meters every READ_INTERVAL seconds.
    - Always accumulate for next batch.
    - If realtime is active, also publish to /realtime.
    """
    while not shutdown_event.is_set():
        try:
            readings = read_all_devices()

            if readings:
                # Only accumulate confirmed devices for batch publishing
                confirmed = [r for r in readings if r.get('confirmed', False)]
                if confirmed:
                    with accumulator_lock:
                        readings_accumulator.extend(confirmed)

                if realtime_active.is_set():
                    publish_realtime(readings)

                # Log summary
                for r in readings:
                    data = r.get("data", {})
                    status = "✓" if r.get('confirmed') else "⏳"
                    logger.info(
                        f"[READ] {status} {r['device_name']}: "
                        f"V={data.get('voltage_l1_n', 'N/A')}V | "
                        f"P={data.get('power_w_total', 'N/A')}W | "
                        f"PF={data.get('power_factor', 'N/A')} | "
                        f"E={data.get('energy_kwh_total', 'N/A')}kWh"
                    )

        except Exception as e:
            logger.error(f"[READER] Error: {e}")

        shutdown_event.wait(READ_INTERVAL)


def average_readings(batch):
    """
    Average all readings per device.
    Numeric fields are averaged, non-numeric keep last value.
    This ensures peaks/dips are reflected in the batch instead of
    only keeping the last instantaneous reading.
    """
    by_device = {}
    for r in batch:
        did = r["device_id"]
        by_device.setdefault(did, []).append(r)

    result = []
    for did, readings in by_device.items():
        base = readings[-1].copy()  # Use last reading as template (timestamp, metadata)
        # Average the data fields
        data_keys = set()
        for r in readings:
            data_keys.update(r.get("data", {}).keys())

        avg_data = {}
        for key in data_keys:
            vals = [r["data"][key] for r in readings
                    if key in r.get("data", {}) and r["data"][key] is not None]
            if vals and isinstance(vals[0], (int, float)):
                avg_data[key] = round(sum(vals) / len(vals), 4)
            elif vals:
                avg_data[key] = vals[-1]  # Non-numeric: keep last

        base["data"] = avg_data
        base["samples"] = len(readings)  # How many readings were averaged
        result.append(base)

    return result


def last_readings(batch):
    """
    Keep only the most recent reading per device.
    Use when the user prefers instantaneous values over averaged ones.
    """
    latest = {}
    for r in batch:
        latest[r["device_id"]] = r
    return list(latest.values())


def batch_loop():
    """Every BATCH_INTERVAL, aggregate accumulated readings and publish as a batch."""
    elapsed = 0
    while not shutdown_event.is_set():
        shutdown_event.wait(1)  # 1s micro-sleep → reacts to config changes instantly
        if shutdown_event.is_set():
            break
        elapsed += 1
        if elapsed < BATCH_INTERVAL:
            continue
        elapsed = 0

        with accumulator_lock:
            batch = list(readings_accumulator)
            readings_accumulator.clear()

        if batch:
            if BATCH_MODE == "average":
                aggregated = average_readings(batch)
                mode_label = f"averaged from {len(batch)} raw samples"
            else:
                aggregated = last_readings(batch)
                mode_label = f"last of {len(batch)} raw samples"

            publish_batch(aggregated)
            logger.info(
                f"[BATCH] Sent {len(aggregated)} device readings "
                f"({mode_label})"
            )
        else:
            logger.debug("[BATCH] No readings to send")


def maintenance_loop():
    """Periodic maintenance: stale retries, cleanup."""
    while not shutdown_event.is_set():
        shutdown_event.wait(60)
        if shutdown_event.is_set():
            break

        buffer.reset_stale_sent(max_age_seconds=120)
        buffer.cleanup_old(max_age_hours=168)

        stats = buffer.get_stats()
        if stats["total_batches"] > 0:
            logger.info(f"[MAINT] Buffer: {stats}")


def flush_loop():
    """Periodically re-send pending batches from the buffer."""
    while not shutdown_event.is_set():
        shutdown_event.wait(FLUSH_INTERVAL)
        if shutdown_event.is_set():
            break
        flush_pending_batches()


def scan_loop():
    """Periodic network scan to discover new meters."""
    while not shutdown_event.is_set():
        shutdown_event.wait(SCAN_INTERVAL)
        if shutdown_event.is_set():
            break
        logger.info(f"[SCAN] Periodic scan (every {SCAN_INTERVAL // 3600}h)...")
        run_scan()


# ── Boot Scan ──

def boot_scan():
    """Network scan on boot to auto-discover meters (non-blocking)."""
    if NETWORK_CFG.get("scan_on_boot", False):
        logger.info("[BOOT] Starting network scan in background...")
        threading.Thread(target=run_scan, daemon=True).start()


# ── Graceful Shutdown ──

def shutdown(signum=None, frame=None):
    if shutdown_event.is_set():
        return  # Prevent double shutdown
    logger.info("[SHUTDOWN] Stopping...")
    shutdown_event.set()
    realtime_active.clear()

    # Flush remaining confirmed readings to buffer (even if MQTT is down)
    with accumulator_lock:
        confirmed = [r for r in readings_accumulator if r.get('confirmed', False)]
        if confirmed:
            logger.info(
                f"[SHUTDOWN] Flushing {len(confirmed)} confirmed readings to buffer..."
            )
            latest = {}
            for r in confirmed:
                latest[r["device_id"]] = r
            publish_batch(list(latest.values()))
        readings_accumulator.clear()

    # Disconnect MQTT gracefully
    if mqtt_client:
        try:
            mqtt_client.loop_stop()
            mqtt_client.disconnect()
        except Exception as e:
            logger.warning(f"[SHUTDOWN] MQTT disconnect error: {e}")

    close_all_clients()
    cleanup_pid_file()
    stats = buffer.get_stats()
    logger.info(f"[SHUTDOWN] Final buffer state: {stats}")
    logger.info("[SHUTDOWN] Goodbye!")
    sys.exit(0)


# ── Signal Handlers ──

def handle_sighup(signum, frame):
    """SIGHUP = hot-reload config (called by web_config.py on save)."""
    global FACTORY_ID, MQTT_CFG, NETWORK_CFG, INTERVALS
    global BATCH_INTERVAL, REALTIME_INTERVAL, READ_INTERVAL, SCAN_INTERVAL, BATCH_MODE
    global mqtt_client

    logger.info("[RELOAD] SIGHUP received — reloading config...")
    try:
        with open(CONFIG_PATH) as f:
            new_config = json.load(f)

        # Update device list
        with devices_lock:
            devices.clear()
            devices.extend(new_config.get("devices", []))

        # Check if MQTT config changed
        new_mqtt = new_config.get("mqtt", {})
        mqtt_changed = (
            new_mqtt.get("broker_host") != MQTT_CFG.get("broker_host")
            or new_mqtt.get("broker_port") != MQTT_CFG.get("broker_port")
            or new_mqtt.get("username") != MQTT_CFG.get("username")
            or new_mqtt.get("password") != MQTT_CFG.get("password")
            or new_mqtt.get("tls", {}).get("enabled") != MQTT_CFG.get("tls", {}).get("enabled")
        )

        # Update globals
        FACTORY_ID = new_config["factory_id"]
        MQTT_CFG = new_mqtt
        NETWORK_CFG = new_config.get("network", {})
        INTERVALS = new_config.get("intervals", {})
        BATCH_INTERVAL = INTERVALS.get("batch_seconds", 300)
        READ_INTERVAL = INTERVALS.get("read_seconds", 5)
        SCAN_INTERVAL = INTERVALS.get("scan_interval_hours", 24) * 3600
        BATCH_MODE = INTERVALS.get("batch_mode", "average")

        # Update scanner range
        scanner.scan_range = (
            NETWORK_CFG.get("scan_range_start", "192.168.1.1"),
            NETWORK_CFG.get("scan_range_end", "192.168.1.254"),
        )
        scanner.scan_port = NETWORK_CFG.get("scan_port", 502)

        # Reconnect MQTT if config changed
        if mqtt_changed:
            logger.info("[RELOAD] MQTT config changed — reconnecting...")
            if mqtt_client:
                try:
                    mqtt_client.loop_stop()
                    mqtt_client.disconnect()
                except Exception:
                    pass
            setup_mqtt()

        logger.info(f"[RELOAD] Config reloaded: {len(devices)} devices, MQTT={'reconnected' if mqtt_changed else 'unchanged'}")

    except Exception as e:
        logger.error(f"[RELOAD] Error reloading config: {e}")


def handle_sigusr1(signum, frame):
    """SIGUSR1 = trigger network scan (called by web_config.py scan button)."""
    logger.info("[SIGNAL] SIGUSR1 received — triggering network scan...")
    threading.Thread(target=run_scan, daemon=True).start()


# ── PID File ──

def write_pid_file():
    """Write PID file for web_config.py to signal us."""
    os.makedirs(os.path.dirname(PID_FILE), exist_ok=True)
    with open(PID_FILE, 'w') as f:
        f.write(str(os.getpid()))
    logger.info(f"[PID] Written to {PID_FILE}")


def cleanup_pid_file():
    """Remove PID file on shutdown."""
    try:
        if os.path.exists(PID_FILE):
            os.remove(PID_FILE)
    except Exception:
        pass


# ── Entry Point ──

def main():
    logger.info("=" * 60)
    logger.info("  Voltio Gateway v2.0 — Multi-Meter (CG + Eastron)")
    logger.info(f"  Factory: {FACTORY_ID}")
    logger.info(f"  Devices: {len(devices)}")
    logger.info(f"  Batch: every {BATCH_INTERVAL}s | Read: every {READ_INTERVAL}s")
    logger.info(f"  Scan range: {NETWORK_CFG.get('scan_range_start')} → {NETWORK_CFG.get('scan_range_end')}")
    logger.info(f"  Config panel: http://localhost:8080")
    logger.info("=" * 60)

    # Signal handlers
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGHUP, handle_sighup)     # Hot-reload config
    signal.signal(signal.SIGUSR1, handle_sigusr1)   # Trigger scan
    # PID file (for web_config.py to find us)
    write_pid_file()

    # Connect MQTT (non-blocking — runs in offline mode if broker unavailable)
    setup_mqtt()

    # Boot scan (auto-discover devices on the network)
    boot_scan()

    # Start threads
    threads = [
        threading.Thread(target=reader_loop, name="reader", daemon=True),
        threading.Thread(target=batch_loop, name="batch", daemon=True),
        threading.Thread(target=flush_loop, name="flush", daemon=True),
        threading.Thread(target=maintenance_loop, name="maint", daemon=True),
        threading.Thread(target=scan_loop, name="scan", daemon=True),
    ]
    for t in threads:
        t.start()
        logger.info(f"[MAIN] Started thread: {t.name}")

    # Main thread waits
    logger.info("[MAIN] Running. Press Ctrl+C to stop.")
    try:
        while not shutdown_event.is_set():
            shutdown_event.wait(1)
    except KeyboardInterrupt:
        shutdown()


if __name__ == "__main__":
    main()

