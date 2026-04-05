#!/usr/bin/env python3
"""
Voltio Gateway — Web Config Panel
Local web interface for factory operators to configure the gateway.

Run:  python3 web_config.py
Open: http://localhost:8080

Features:
  - Configure MQTT broker (host, port, credentials, TLS)
  - View discovered devices and their status
  - Trigger network scan
  - Hot-reload: saves config and signals main.py to reload (no restart needed)
"""

import json
import os
import signal
import subprocess
import sys
from datetime import datetime

try:
    from flask import Flask, render_template_string, request, jsonify, redirect
except ImportError:
    print("Flask not installed. Install with: pip install flask")
    sys.exit(1)

# ── Paths ──
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, '..', 'config', 'config.json')
PID_FILE = os.path.join(BASE_DIR, '..', 'data', 'gateway.pid')

app = Flask(__name__)


def load_config():
    """Load current config from JSON."""
    with open(CONFIG_PATH) as f:
        return json.load(f)


def save_config(cfg):
    """Atomic save: write to .tmp then rename."""
    tmp = CONFIG_PATH + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(cfg, f, indent=4)
    os.replace(tmp, CONFIG_PATH)


def signal_reload():
    """Send SIGHUP to the gateway main process to hot-reload config."""
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE) as f:
                pid = int(f.read().strip())
            os.kill(pid, signal.SIGHUP)
            return True, pid
        except (ValueError, ProcessLookupError, PermissionError) as e:
            return False, str(e)
    return False, "PID file not found"


# ── HTML Template ──

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Voltio Gateway — Configuración</title>
    <style>
        :root {
            --bg: #0a0a0f;
            --card: #12121a;
            --border: #1e1e2e;
            --accent: #6366f1;
            --accent-hover: #818cf8;
            --text: #e2e8f0;
            --text-dim: #94a3b8;
            --success: #22c55e;
            --warning: #f59e0b;
            --danger: #ef4444;
            --radius: 12px;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            padding: 24px;
        }

        .container { max-width: 720px; margin: 0 auto; }

        .header {
            text-align: center;
            margin-bottom: 32px;
            padding: 24px;
            background: linear-gradient(135deg, rgba(99,102,241,0.1), rgba(99,102,241,0.02));
            border: 1px solid var(--border);
            border-radius: var(--radius);
        }
        .header h1 {
            font-size: 1.5rem;
            font-weight: 700;
            letter-spacing: -0.02em;
        }
        .header h1 span { color: var(--accent); }
        .header p { color: var(--text-dim); font-size: 0.85rem; margin-top: 4px; }

        .status-bar {
            display: flex;
            gap: 16px;
            justify-content: center;
            margin-top: 12px;
        }
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 600;
            background: rgba(255,255,255,0.05);
        }
        .status-dot {
            width: 8px; height: 8px;
            border-radius: 50%;
            display: inline-block;
        }
        .status-dot.online { background: var(--success); box-shadow: 0 0 8px var(--success); }
        .status-dot.offline { background: var(--danger); box-shadow: 0 0 8px var(--danger); }
        .status-dot.pending { background: var(--warning); box-shadow: 0 0 8px var(--warning); }

        .card {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 24px;
            margin-bottom: 16px;
        }
        .card-title {
            font-size: 1rem;
            font-weight: 600;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .form-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }
        .form-group { display: flex; flex-direction: column; gap: 4px; }
        .form-group.full { grid-column: 1 / -1; }

        label {
            font-size: 0.75rem;
            font-weight: 600;
            color: var(--text-dim);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        input, select {
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 10px 12px;
            color: var(--text);
            font-size: 0.9rem;
            font-family: inherit;
            transition: border-color 0.2s;
        }
        input:focus, select:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
        }

        .checkbox-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 0;
        }
        .checkbox-row input[type="checkbox"] {
            width: 18px; height: 18px;
            accent-color: var(--accent);
        }

        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-family: inherit;
        }
        .btn-primary {
            background: var(--accent);
            color: white;
        }
        .btn-primary:hover { background: var(--accent-hover); transform: translateY(-1px); }
        .btn-secondary {
            background: rgba(255,255,255,0.08);
            color: var(--text);
            border: 1px solid var(--border);
        }
        .btn-secondary:hover { background: rgba(255,255,255,0.12); }

        .btn-row {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            margin-top: 16px;
        }

        .device-list { list-style: none; }
        .device-item {
            padding: 12px 16px;
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 8px;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .device-info h4 {
            font-size: 0.9rem;
            font-weight: 600;
            margin-bottom: 2px;
        }
        .device-info p {
            font-size: 0.75rem;
            color: var(--text-dim);
        }
        .device-status {
            font-size: 0.7rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }

        .toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 600;
            color: white;
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.3s;
            z-index: 100;
        }
        .toast.show { opacity: 1; transform: translateY(0); }
        .toast.success { background: var(--success); }
        .toast.error { background: var(--danger); }

        .empty-state {
            text-align: center;
            padding: 24px;
            color: var(--text-dim);
            font-size: 0.85rem;
        }

        .btn-delete {
            background: transparent;
            color: var(--text-dim);
            border: 1px solid var(--border);
            width: 28px; height: 28px;
            padding: 0;
            font-size: 0.8rem;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .btn-delete:hover {
            background: var(--danger);
            color: white;
            border-color: var(--danger);
        }

        @media (max-width: 600px) {
            .form-grid { grid-template-columns: 1fr; }
            body { padding: 12px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <h1>⚡ <span>Voltio</span> Gateway</h1>
            <p>Panel de configuración local</p>
            <div class="status-bar">
                <span class="status-badge">
                    <span class="status-dot {{ 'online' if gateway_running else 'offline' }}"></span>
                    Gateway: {{ 'Activo' if gateway_running else 'Detenido' }}
                </span>
                <span class="status-badge">
                    <span class="status-dot {{ 'online' if mqtt_connected else 'offline' }}"></span>
                    MQTT: {{ 'Conectado' if mqtt_connected else 'Desconectado' }}
                </span>
                <span class="status-badge">
                    📡 {{ devices | length }} dispositivo{{ 's' if devices | length != 1 }}
                </span>
            </div>
        </div>

        <!-- MQTT Config -->
        <form method="POST" action="/save" id="configForm">
            <div class="card">
                <div class="card-title">🏭 Fábrica</div>
                <div class="form-grid">
                    <div class="form-group full">
                        <label>Factory ID (UUID)</label>
                        <input type="text" name="factory_id" value="{{ factory_id }}"
                               placeholder="91ddc8de-a84e-4d98-88ef-95b5a78747a2" required
                               style="font-family: monospace; font-size: 0.8rem;">
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-title">🔌 Servidor MQTT</div>
                <div class="form-grid">
                    <div class="form-group">
                        <label>Host / IP</label>
                        <input type="text" name="broker_host" value="{{ mqtt.broker_host }}"
                               placeholder="voltio.example.com" required>
                    </div>
                    <div class="form-group">
                        <label>Puerto</label>
                        <input type="number" name="broker_port" value="{{ mqtt.broker_port }}"
                               placeholder="8883" required>
                    </div>
                    <div class="form-group">
                        <label>Usuario</label>
                        <input type="text" name="username" value="{{ mqtt.username }}"
                               placeholder="fabrica_01" required>
                    </div>
                    <div class="form-group">
                        <label>Contraseña</label>
                        <input type="password" name="password" value="{{ mqtt.password }}"
                               placeholder="••••••••" required>
                    </div>
                    <div class="form-group full">
                        <label>Prefijo Client ID</label>
                        <input type="text" name="client_id_prefix" value="{{ mqtt.client_id_prefix }}"
                               placeholder="rpi_factory">
                    </div>
                    <div class="form-group full">
                        <div class="checkbox-row">
                            <input type="checkbox" name="tls_enabled" id="tls_enabled"
                                   {{ 'checked' if mqtt.tls.enabled }}>
                            <label for="tls_enabled" style="text-transform:none;font-size:0.85rem;color:var(--text)">
                                Activar TLS (puerto 8883)
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Network Config -->
            <div class="card">
                <div class="card-title">🌐 Red de escaneo</div>
                <div class="form-grid">
                    <div class="form-group">
                        <label>IP Inicio</label>
                        <input type="text" name="scan_range_start" value="{{ network.scan_range_start }}"
                               placeholder="10.10.10.1">
                    </div>
                    <div class="form-group">
                        <label>IP Fin</label>
                        <input type="text" name="scan_range_end" value="{{ network.scan_range_end }}"
                               placeholder="10.10.10.50">
                    </div>
                    <div class="form-group">
                        <label>Puerto Modbus</label>
                        <input type="number" name="scan_port" value="{{ network.get('scan_port', 502) }}"
                               placeholder="502">
                    </div>
                    <div class="form-group">
                        <label>Escaneo cada (horas)</label>
                        <input type="number" name="scan_interval_hours"
                               value="{{ intervals.get('scan_interval_hours', 24) }}"
                               placeholder="24" min="1">
                    </div>
                </div>
            </div>

            <!-- Batch Config -->
            <div class="card">
                <div class="card-title">📊 Envío de datos (Batch)</div>
                <div class="form-grid">
                    <div class="form-group">
                        <label>Envío cada (segundos)</label>
                        <input type="number" name="batch_seconds"
                               value="{{ intervals.get('batch_seconds', 300) }}"
                               placeholder="300" min="10">
                    </div>
                    <div class="form-group">
                        <label>Modo de agregación</label>
                        <select name="batch_mode">
                            <option value="average" {{ 'selected' if intervals.get('batch_mode', 'average') == 'average' }}>
                                📈 Promedio (recomendado)
                            </option>
                            <option value="last" {{ 'selected' if intervals.get('batch_mode') == 'last' }}>
                                📌 Última lectura
                            </option>
                        </select>
                    </div>
                    <div class="form-group full" style="font-size:0.75rem;color:var(--text-dim);padding:4px 0;">
                        💡 <strong>Promedio:</strong> Media de todas las lecturas del intervalo. Captura picos y valles.
                        <br>📌 <strong>Última lectura:</strong> Solo envía el valor instantáneo más reciente.
                    </div>
                </div>
            </div>

            <!-- Save Button -->
            <div class="btn-row">
                <button type="button" class="btn btn-secondary" onclick="triggerScan()">
                    🔍 Escanear Red Ahora
                </button>
                <button type="submit" class="btn btn-primary">
                    💾 Guardar y Aplicar
                </button>
            </div>
        </form>

        <!-- Devices -->
        <div class="card" style="margin-top: 24px;">
            <div class="card-title">📡 Dispositivos</div>
            {% if devices %}
            <ul class="device-list">
                {% for dev in devices %}
                <li class="device-item">
                    <div class="device-info">
                        <h4>{{ dev.name }}</h4>
                        <p>{{ dev.get('model', 'Unknown') }} · {{ dev.host }}:{{ dev.port }} · Modbus #{{ dev.modbus_address }}</p>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                        {% if dev.device_id.startswith('auto_') or dev.device_id == 'DEVICE_UUID' %}
                        <span class="device-status" style="color:var(--warning)">
                            <span class="status-dot pending"></span> Pendiente
                        </span>
                        {% else %}
                        <span class="device-status" style="color:var(--success)">
                            <span class="status-dot online"></span> Confirmado
                        </span>
                        {% endif %}
                        <button class="btn btn-delete" onclick="deleteDevice('{{ dev.host }}', '{{ dev.name }}')"
                                title="Eliminar dispositivo">✕</button>
                    </div>
                </li>
                {% endfor %}
            </ul>
            {% else %}
            <div class="empty-state">
                No hay dispositivos configurados.<br>
                Pulsa "Escanear Red" para buscar medidores.
            </div>
            {% endif %}
        </div>

        <p style="text-align:center;color:var(--text-dim);font-size:0.7rem;margin-top:24px;">
            Factory ID: {{ factory_id }}<br>
            Voltio Gateway v2.0
        </p>
    </div>

    <!-- Toast notification -->
    <div class="toast" id="toast"></div>

    <script>
        // Show toast from URL params
        const params = new URLSearchParams(window.location.search);
        if (params.get('saved')) showToast('✅ Configuración guardada y aplicada', 'success');
        if (params.get('error')) showToast('❌ ' + params.get('error'), 'error');
        if (params.get('scanning')) showToast('🔍 Escaneo de red iniciado...', 'success');

        function showToast(msg, type) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.className = 'toast show ' + type;
            setTimeout(() => t.className = 'toast', 3000);
        }

        function triggerScan() {
            fetch('/scan', { method: 'POST' })
                .then(r => r.json())
                .then(data => {
                    if (data.ok) {
                        showToast('🔍 Escaneo iniciado — recarga en unos segundos', 'success');
                        setTimeout(() => location.reload(), 15000);
                    } else {
                        showToast('❌ ' + data.error, 'error');
                    }
                });
        }

        function deleteDevice(host, name) {
            if (!confirm(`¿Eliminar "${name}" (${host})? \nEl dispositivo dejará de ser leído.`)) return;
            fetch('/delete_device', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host: host }),
            })
                .then(r => r.json())
                .then(data => {
                    if (data.ok) {
                        showToast('🗑️ Dispositivo eliminado', 'success');
                        setTimeout(() => location.reload(), 1000);
                    } else {
                        showToast('❌ ' + data.error, 'error');
                    }
                });
        }

        // Clean URL params after showing toast
        if (params.toString()) {
            history.replaceState({}, '', '/');
        }
    </script>
</body>
</html>
"""


# ── Routes ──

@app.route('/')
def index():
    cfg = load_config()
    gateway_running = os.path.exists(PID_FILE)

    # Check MQTT connection status via pid file
    mqtt_connected = False
    if gateway_running:
        try:
            with open(PID_FILE) as f:
                pid = int(f.read().strip())
            os.kill(pid, 0)  # Check if process is alive (signal 0)
            mqtt_connected = True  # Approximate: process alive = likely connected
        except (ValueError, ProcessLookupError, PermissionError):
            gateway_running = False

    return render_template_string(
        HTML_TEMPLATE,
        factory_id=cfg.get('factory_id', 'N/A'),
        mqtt=cfg.get('mqtt', {}),
        network=cfg.get('network', {}),
        intervals=cfg.get('intervals', {}),
        devices=cfg.get('devices', []),
        gateway_running=gateway_running,
        mqtt_connected=mqtt_connected,
    )


@app.route('/save', methods=['POST'])
def save():
    try:
        cfg = load_config()

        # Update Factory ID
        cfg['factory_id'] = request.form.get('factory_id', cfg.get('factory_id', ''))

        # Update MQTT
        cfg['mqtt']['broker_host'] = request.form.get('broker_host', 'localhost')
        cfg['mqtt']['broker_port'] = int(request.form.get('broker_port', 1883))
        cfg['mqtt']['username'] = request.form.get('username', '')
        cfg['mqtt']['password'] = request.form.get('password', '')
        cfg['mqtt']['client_id_prefix'] = request.form.get('client_id_prefix', 'rpi_factory')
        cfg['mqtt']['tls']['enabled'] = 'tls_enabled' in request.form

        # Update network
        cfg['network']['scan_range_start'] = request.form.get('scan_range_start', '192.168.1.1')
        cfg['network']['scan_range_end'] = request.form.get('scan_range_end', '192.168.1.254')
        cfg['network']['scan_port'] = int(request.form.get('scan_port', 502))

        # Update intervals
        cfg['intervals']['scan_interval_hours'] = int(request.form.get('scan_interval_hours', 24))
        cfg['intervals']['batch_seconds'] = int(request.form.get('batch_seconds', 300))
        cfg['intervals']['batch_mode'] = request.form.get('batch_mode', 'average')

        save_config(cfg)

        # Signal main.py to hot-reload
        success, info = signal_reload()
        if success:
            print(f"[CONFIG] Saved & signaled main process (PID {info}) to reload")
        else:
            print(f"[CONFIG] Saved but could not signal main process: {info}")

        return redirect('/?saved=1')

    except Exception as e:
        return redirect(f'/?error={str(e)}')


@app.route('/scan', methods=['POST'])
def scan():
    """Trigger a network scan by sending SIGUSR1 to the gateway."""
    success, info = signal_reload_scan()
    if success:
        return jsonify({'ok': True, 'message': f'Scan triggered (PID {info})'})
    return jsonify({'ok': False, 'error': info})


def signal_reload_scan():
    """Send SIGUSR1 to trigger a network scan."""
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE) as f:
                pid = int(f.read().strip())
            os.kill(pid, signal.SIGUSR1)
            return True, pid
        except (ValueError, ProcessLookupError, PermissionError) as e:
            return False, str(e)
    return False, "Gateway no está ejecutándose (PID file no encontrado)"


@app.route('/delete_device', methods=['POST'])
def delete_device():
    """Remove a device by host IP."""
    try:
        data = request.get_json()
        host = data.get('host')
        if not host:
            return jsonify({'ok': False, 'error': 'Host no especificado'})

        cfg = load_config()
        original_count = len(cfg.get('devices', []))
        cfg['devices'] = [d for d in cfg.get('devices', []) if d.get('host') != host]
        removed = original_count - len(cfg['devices'])

        if removed == 0:
            return jsonify({'ok': False, 'error': f'No se encontró dispositivo en {host}'})

        save_config(cfg)
        success, info = signal_reload()

        return jsonify({
            'ok': True,
            'removed': removed,
            'reloaded': success,
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)})


@app.route('/api/status')
def api_status():
    """JSON API for status polling."""
    cfg = load_config()
    return jsonify({
        'factory_id': cfg.get('factory_id'),
        'devices': cfg.get('devices', []),
        'mqtt': {
            'host': cfg['mqtt']['broker_host'],
            'port': cfg['mqtt']['broker_port'],
        },
    })


if __name__ == '__main__':
    print("=" * 50)
    print("  ⚡ Voltio Gateway — Panel de Configuración")
    print("  http://localhost:8080")
    print("=" * 50)

    app.run(
        host='0.0.0.0',
        port=8080,
        debug=False,
    )
