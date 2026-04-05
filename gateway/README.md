# ⚡ Voltio Gateway v2.0

**Gateway industrial multi-medidor para mini PCs y Raspberry Pi de fábrica.**

Lee medidores de energía Modbus TCP (Carlo Gavazzi + Eastron), procesa los datos y los envía al backend Voltio via MQTT. Incluye auto-descubrimiento de dispositivos, buffering offline (store-and-forward), y un panel web de configuración local.

---

## Tabla de Contenidos

- [Arquitectura General](#arquitectura-general)
- [Estructura de Ficheros](#estructura-de-ficheros)
- [Instalación y Ejecución](#instalación-y-ejecución)
- [Configuración (config.json)](#configuración-configjson)
- [Módulos del Sistema](#módulos-del-sistema)
  - [main.py — Orquestador Principal](#mainpy--orquestador-principal)
  - [modbus_reader.py — Lector Modbus TCP](#modbus_readerpy--lector-modbus-tcp)
  - [data_processor.py — Procesador de Datos](#data_processorpy--procesador-de-datos)
  - [network_scanner.py — Escáner de Red](#network_scannerpy--escáner-de-red)
  - [data_buffer.py — Buffer Offline (SQLite)](#data_bufferpy--buffer-offline-sqlite)
  - [web_config.py — Panel Web de Configuración](#web_configpy--panel-web-de-configuración)
- [Flujos de Datos](#flujos-de-datos)
- [Protocolos Soportados](#protocolos-soportados)
- [Comunicación MQTT](#comunicación-mqtt)
- [Resiliencia y Edge Cases](#resiliencia-y-edge-cases)
- [Despliegue en Producción](#despliegue-en-producción)

---

## Arquitectura General

```
┌─────────────────────────────────────────────────────────────┐
│                    MINI PC / RASPBERRY PI                     │
│                                                               │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐ │
│  │ web_config.py │   │   main.py    │   │   buffer.db      │ │
│  │  (Flask:8080) │──▶│ (Orquestador)│──▶│  (SQLite store   │ │
│  │  Config panel │   │              │   │   & forward)     │ │
│  └──────────────┘   └──────┬───────┘   └──────────────────┘ │
│                            │                                  │
│         ┌──────────────────┼──────────────────┐              │
│         ▼                  ▼                  ▼              │
│   ┌────────────┐   ┌────────────┐   ┌──────────────┐       │
│   │  modbus_   │   │   data_    │   │  network_    │       │
│   │  reader.py │   │  processor │   │  scanner.py  │       │
│   │            │   │   .py      │   │              │       │
│   │ FC03 / FC04│   │ INT / F32  │   │ TCP scan +   │       │
│   └─────┬──────┘   └────────────┘   │ Modbus probe │       │
│         │                            └──────────────┘       │
└─────────┼───────────────────────────────────────────────────┘
          │ Modbus TCP (port 502)
          ▼
    ┌───────────┐     ┌───────────┐     ┌───────────┐
    │ USR-TCP232│     │ USR-TCP232│     │ USR-TCP232│
    │   :502    │     │   :502    │     │   :502    │
    └─────┬─────┘     └─────┬─────┘     └─────┬─────┘
          │ RS485           │ RS485           │ RS485
    ┌─────┴─────┐     ┌─────┴─────┐     ┌─────┴─────┐
    │ SDM630MCT │     │  EM340    │     │   EM111   │
    │ (Eastron) │     │ (C.Gavaz) │     │ (C.Gavaz) │
    │ Trifásica │     │ Trifásica │     │ Monofásica│
    └───────────┘     └───────────┘     └───────────┘
```

---

## Estructura de Ficheros

```
gateway/
├── config/
│   ├── config.json        # Configuración principal (MQTT, red, dispositivos)
│   └── registers.json     # Mapa de registros Modbus por tipo de medidor
├── data/
│   ├── buffer.db          # SQLite store-and-forward (auto-creado)
│   └── gateway.pid        # PID del proceso main.py (auto-creado)
├── src/
│   ├── main.py            # Orquestador: threads, MQTT, scheduling
│   ├── modbus_reader.py   # Lectura Modbus TCP (FC03 + FC04)
│   ├── data_processor.py  # Decodificación registros → valores ingeniería
│   ├── network_scanner.py # Auto-descubrimiento de medidores en la red
│   ├── data_buffer.py     # Buffer SQLite para offline/store-and-forward
│   └── web_config.py      # Panel web Flask (config + status)
└── requirements.txt       # Dependencias Python
```

---

## Instalación y Ejecución

```bash
# Instalar dependencias
pip install -r requirements.txt

# Ejecutar el gateway
cd gateway
python3 src/main.py

# Ejecutar el panel web (en otra terminal)
python3 src/web_config.py
# → http://localhost:8080
```

**Dependencias:**
| Paquete | Versión | Uso |
|---------|---------|-----|
| `pymodbus` | ≥3.6.0 | Comunicación Modbus TCP |
| `paho-mqtt` | ≥2.0.0 | Cliente MQTT (CallbackAPIVersion.VERSION2) |
| `flask` | ≥3.0.0 | Panel web de configuración |

---

## Configuración (config.json)

```jsonc
{
    "factory_id": "91ddc8de-...",       // UUID de la fábrica (del backend)
    "mqtt": {
        "broker_host": "voltio.server.com",
        "broker_port": 8883,
        "username": "fabrica_01",
        "password": "xxxx",
        "client_id_prefix": "rpi_factory",
        "tls": {
            "enabled": true,
            "ca_cert": "./certs/ca.crt"
        }
    },
    "network": {
        "scan_range_start": "192.168.1.1",  // Rango de IPs a escanear
        "scan_range_end": "192.168.1.254",
        "scan_port": 502,                    // Puerto Modbus TCP
        "scan_on_boot": true,                // Escanear al arrancar
        "scan_timeout": 1                    // Timeout TCP por IP (seg)
    },
    "devices": [                            // Lista de dispositivos activos
        {
            "device_id": "uuid-del-backend", // UUID (auto_ = no confirmado)
            "name": "Compresor 1",
            "device_type": "trifasica",      // Tipo para BD backend
            "model": "SDM630MCT-V2",         // Modelo hardware → selecciona protocolo
            "host": "192.168.1.200",
            "port": 502,
            "modbus_address": 1
        }
    ],
    "intervals": {
        "read_seconds": 5,           // Frecuencia lectura Modbus
        "batch_seconds": 300,        // Envío batch cada 5 min
        "realtime_seconds": 5,       // Frecuencia realtime (dashboard abierto)
        "flush_seconds": 30,         // Re-envío batches pendientes
        "scan_interval_hours": 24    // Escaneo periódico de red
    }
}
```

---

## Módulos del Sistema

### main.py — Orquestador Principal

**Responsabilidades:** Arranca todos los threads, gestiona MQTT, coordina lectura/envío.

#### Threads

| Thread | Función | Frecuencia | Descripción |
|--------|---------|------------|-------------|
| `reader` | `reader_loop()` | Cada `read_seconds` (5s) | Lee todos los dispositivos y acumula readings |
| `batch` | `batch_loop()` | Cada `batch_seconds` (300s) | Promedia readings acumulados → envía batch |
| `flush` | `flush_loop()` | Cada `flush_seconds` (30s) | Re-envía batches pendientes del buffer |
| `scan` | `scan_loop()` | Cada `scan_interval_hours` (24h) | Auto-descubre nuevos medidores |
| `maintenance` | `maintenance_loop()` | Cada 60s | Stats del buffer, reset batches stale |

#### Funciones Principales

| Función | Línea | Descripción |
|---------|-------|-------------|
| `resolve_device_type(device)` | ~95 | Mapea modelo hardware → clave del register map interno (`SDM630MCT-V2` → `sdm630mct`) |
| `is_confirmed(device)` | ~106 | Verifica si tiene UUID real (no `auto_*`) |
| `setup_mqtt()` | ~117 | Configura cliente MQTT con sesión persistente (`clean_session=False`), callbacks |
| `on_message()` | ~170 | Dispatcher MQTT: `/ack` → ACK handler, `/commands` → command handler, `/realtime/control` → toggle |
| `handle_command(payload)` | ~240 | Procesa comandos: `add_device`, `remove_device`, `scan_network`, `start/stop_realtime` |
| `read_all_devices()` | ~330 | Itera dispositivos, lee Modbus, procesa datos, envía realtime si activo |
| `reader_loop()` | ~430 | Thread principal de lectura continua |
| `batch_loop()` | ~450 | Promedia readings acumulados → batch MQTT + buffer SQLite |
| `flush_loop()` | ~500 | Reenvía batches pendientes del buffer |
| `run_scan()` | ~550 | Ejecuta escaneo de red → publica discovery MQTT |
| `handle_sighup()` | ~630 | Hot-reload: recarga config.json + reconecta MQTT si cambió |
| `handle_sigusr1()` | ~680 | Trigger de escaneo manual (desde web_config.py) |

#### Telemetry Gating

El gateway solo envía telemetría para dispositivos **confirmados** (con UUID real del backend). Los dispositivos auto-descubiertos (`device_id: "auto_*"`) se leen para verificar conectividad pero NO se publica su telemetría.

```python
if not is_confirmed(dev):
    # Solo verificar que responde, no publicar
    continue
```

#### Signal Handlers

| Signal | Handler | Uso |
|--------|---------|-----|
| `SIGINT` / `SIGTERM` | `shutdown()` | Parada limpia: flush buffer, desconectar MQTT |
| `SIGHUP` | `handle_sighup()` | Hot-reload config desde web_config.py |
| `SIGUSR1` | `handle_sigusr1()` | Trigger escaneo red desde web_config.py |

#### PID File

Al arrancar, escribe su PID en `data/gateway.pid`. Lo usa `web_config.py` para enviar signals. Se limpia al salir.

---

### modbus_reader.py — Lector Modbus TCP

**Responsabilidades:** Conexión TCP, lectura de registros, auto-probe de tipo de medidor.

#### Clase `ModbusReader`

```python
reader = ModbusReader(timeout=3, retries=2)

# Lectura completa de un medidor
raw_data = reader.read_device(
    host='192.168.1.200',
    port=502,
    modbus_address=1,
    device_type='sdm630mct'  # Selecciona FC03 o FC04
)

# Auto-identificación de tipo
probe_result = reader.probe_device(host='192.168.1.200')
# → {'type': 'sdm630mct', 'model': 'SDM630MCT-V2', 'protocol': 'input_float32', ...}
```

#### Funciones Principales

| Función | Descripción |
|---------|-------------|
| `read_device(host, port, modbus_address, device_type)` | Lee todos los bloques de registros definidos en `registers.json` para ese tipo |
| `probe_device(host, port, modbus_address)` | Prueba FC04 (Eastron) → FC03 (Carlo Gavazzi) para identificar el medidor |
| `connect(host, port)` | Establece conexión TCP con cache de clientes |
| `disconnect(host)` / `disconnect_all()` | Cierra conexiones |

#### Protocolo Dual

```
probe_device():
    1. Intenta FC 04 (Input Registers) → Eastron SDM630MCT?
       - Si voltage L1 entre 50-500V → ✅ SDM630MCT-V2 (siempre trifásica)
    2. Si falla, intenta FC 03 (Holding Registers) → Carlo Gavazzi?
       - Si voltage L1 válido:
         - L2 y L3 también válidos → EM340 (trifásica)
         - Solo L1 → EM111 (monofásica)
```

#### Decoders (funciones módulo)

| Función | Protocolo | Medidores |
|---------|-----------|-----------|
| `decode_float32(regs, index)` | IEEE 754, Big-Endian, 2 registros | Eastron SDM630 |
| `decode_int_divisor(regs, index, size, divisor)` | INT16/32 con divisor | Carlo Gavazzi EM340/EM111 |

#### Cache de Clientes

Los clientes Modbus TCP se cachean por `host:port` en `self._clients` para reutilizar conexiones y evitar el overhead de reconexión continua.

---

### data_processor.py — Procesador de Datos

**Responsabilidades:** Convierte registros Modbus crudos en valores de ingeniería con unidades.

#### Clase `DataProcessor`

```python
processor = DataProcessor(register_map)

# Raw → valores ingeniería
values = processor.process(raw_data, device_type='sdm630mct')
# → {'voltage_l1_n': 238.5, 'power_w_total': 1500.0, 'frequency_hz': 50.01, ...}

# Raw → payload para backend (field names exactos de la BD)
telemetry = processor.process_to_telemetry(raw_data, device_type='sdm630mct')
# → {'voltage_l1_n': 238.5, 'power_w_total': 1500.0, 'power_factor': 0.98, ...}
```

#### Funciones Principales

| Función | Descripción |
|---------|-------------|
| `process(raw_data, device_type)` | Decodifica todos los registros del mapa → dict nombre:valor |
| `process_to_telemetry(raw_data, device_type)` | Como `process()` pero con field names exactos del schema backend |
| `_find_and_decode(raw_data, address, protocol, reg_info)` | Localiza el bloque correcto para una dirección y decodifica |
| `_decode_float32(registers, index)` | IEEE 754 Float32 (SDM630) |
| `_decode_int_divisor(registers, index, size, divisor)` | INT con divisor (Carlo Gavazzi) |

#### Block Resolver

Los registros Modbus se leen en bloques (ej: 0-79, 200-277). El `_find_and_decode` localiza automáticamente qué bloque contiene la dirección del registro y calcula el offset local.

#### Mapeo Telemetry → Backend

`process_to_telemetry()` mapea campos internos a los nombres exactos del schema PostgreSQL:

| Campo Gateway | Campo Backend | Nota |
|---------------|---------------|------|
| `power_factor_total` | `power_factor` | Renombrado |
| `energy_kwh_export_total` | `energy_kwh_neg_total` | SDM630 export → schema neg |
| `energy_kwh_total_l1` | `energy_kwh_l1` | Unificado SDM630/CG |
| `demand_w_total` | `demand_w` | Fallback si no hay `demand_w` |

---

### network_scanner.py — Escáner de Red

**Responsabilidades:** Descubre medidores Modbus TCP nuevos en la red local.

#### Clase `NetworkScanner`

```python
scanner = NetworkScanner(
    modbus_reader=reader,
    scan_range=('192.168.1.1', '192.168.1.254'),
    scan_port=502,
    scan_timeout=1,
)

discovered = scanner.scan()
# → [{'ip_address': '192.168.1.201', 'detected_model': 'SDM630MCT-V2', ...}]
```

#### Proceso de Escaneo (2 fases)

```
Fase 1: TCP Port Scan (paralelo, 20 workers)
    → Para cada IP en el rango, ¿puerto 502 abierto?
    → Resultado: lista de hosts con puerto abierto

Fase 2: Modbus Probe (secuencial)
    → Para cada host abierto, probe_device()
    → Identifica: tipo, modelo, voltajes, fases activas
    → Resultado: lista de dispositivos descubiertos
```

#### `format_discovery_message(factory_id, devices)`

Formatea los resultados como mensaje MQTT para publicar en `factory/{id}/discovery`.

---

### data_buffer.py — Buffer Offline (SQLite)

**Responsabilidades:** Almacena telemetría localmente cuando no hay conexión → re-envía cuando vuelve.

#### Clase `DataBuffer`

```python
buffer = DataBuffer('data/buffer.db')

# Almacenar batch
batch_id = buffer.store(factory_id, readings)

# Obtener batches pendientes
pending = buffer.get_pending(limit=10)

# Marcar como enviado (esperando ACK)
buffer.mark_sent(batch_id)

# ACK recibido → borrar
buffer.mark_confirmed(batch_id)
```

#### Ciclo de Vida de un Batch

```
┌─────────┐     store()     ┌─────────┐    mark_sent()    ┌──────────┐
│ READING │ ──────────────▶ │ PENDING │ ─────────────────▶ │   SENT   │
│ (memory)│                 │ (sqlite)│                    │ (sqlite) │
└─────────┘                 └─────────┘                    └────┬─────┘
                                  ▲                              │
                                  │ reset_stale_sent()       ACK │ mark_confirmed()
                                  │ (sin ACK en 120s)          ▼
                                  └────────────────────    DELETED
```

#### Schema SQLite

```sql
CREATE TABLE telemetry_buffer (
    batch_id      TEXT PRIMARY KEY,     -- UUID
    factory_id    TEXT NOT NULL,
    readings      TEXT NOT NULL,         -- JSON serializado
    reading_count INTEGER NOT NULL,
    status        TEXT DEFAULT 'pending', -- pending | sent
    created_at    TEXT NOT NULL,
    sent_at       TEXT,
    retry_count   INTEGER DEFAULT 0
);
```

#### Funciones de Mantenimiento

| Función | Frecuencia | Acción |
|---------|------------|--------|
| `reset_stale_sent(120)` | Cada 60s | Batches en `sent` sin ACK > 2min → `pending` |
| `cleanup_old(168)` | Cada 60s | Borrar batches > 7 días (safety valve) |

---

### web_config.py — Panel Web de Configuración

**Responsabilidades:** Interfaz web local para operarios de fábrica.

**URL:** `http://localhost:8080` (o `http://[IP-del-minipc]:8080`)

#### Features

- **Configurar Factory ID** (UUID de la fábrica)
- **Configurar MQTT** (host, puerto, credenciales, TLS)
- **Configurar red de escaneo** (rango IP, puerto, intervalo)
- **Ver dispositivos** conectados (confirmados vs pendientes)
- **Eliminar dispositivos** (con confirmación)
- **Escanear red** manualmente
- **Hot-reload** sin reiniciar el gateway

#### Rutas

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET /` | Página principal con formulario y lista de dispositivos |
| `POST /save` | Guarda config.json + envía `SIGHUP` a main.py |
| `POST /scan` | Envía `SIGUSR1` a main.py → escaneo de red |
| `POST /delete_device` | Elimina dispositivo por IP de config.json |
| `GET /api/status` | JSON API para polling de estado |

#### Comunicación con main.py (Signals)

```
web_config.py                    main.py
     │                              │
     │── SIGHUP ──────────────────▶│ handle_sighup()
     │   (config saved)             │  → reload config.json
     │                              │  → reconnect MQTT si cambió
     │                              │
     │── SIGUSR1 ─────────────────▶│ handle_sigusr1()
     │   (scan button)              │  → run_scan() en nuevo thread
```

Usa `data/gateway.pid` para encontrar el PID de main.py.

---

## Flujos de Datos

### Flujo Normal (Batch)

```
1. reader_loop() lee todos los dispositivos cada 5s
2. Datos se acumulan en readings_accumulator[]
3. batch_loop() promedia cada 300s (5 min)
4. Publica → factory/{id}/telemetry
5. Almacena en buffer SQLite (status: pending)
6. Backend procesa → envía ACK en factory/{id}/telemetry/ack
7. Buffer marca confirmed → borra el batch
```

### Flujo Realtime (Dashboard Abierto)

```
1. Usuario abre dashboard → frontend pide realtime via WebSocket
2. Backend publica → factory/{id}/realtime/control {"action": "start"}
3. Gateway activa realtime_active flag
4. reader_loop() publica cada lectura → factory/{id}/realtime
5. Usuario cierra dashboard → stop → flag se desactiva
```

### Flujo Discovery

```
1. Gateway arranca o scan_loop() cada 24h
2. network_scanner escanea IPs → identifica medidores
3. Publica → factory/{id}/discovery
4. Backend almacena en discovered_devices (status: pending)
5. Manager confirma desde el frontend SaaS
6. Backend publica → factory/{id}/commands {"action": "add_device", "device": {...}}
7. Gateway recibe → añade a devices[] → guarda config.json
8. Empieza a leer telemetría del nuevo dispositivo
```

### Flujo Offline

```
1. Internet se cae
2. Batches se almacenan en buffer SQLite (status: pending)
3. flush_loop() intenta enviar cada 30s → falla → sigue acumulando
4. Internet vuelve → MQTT reconecta automáticamente
5. flush_loop() re-envía todos los batches pendientes
6. Backend envía ACK → buffer los borra
```

---

## Protocolos Soportados

### Mapa de Registros (registers.json)

| Clave | Medidor | Protocolo | Function Code | Encoding |
|-------|---------|-----------|---------------|----------|
| `trifasica` | Carlo Gavazzi EM340/EM24 | `holding_int` | FC 03 | INT16/32 + divisor |
| `monofasica` | Carlo Gavazzi EM111 | `holding_int` | FC 03 | INT16/32 + divisor |
| `sdm630mct` | Eastron SDM630MCT V2 | `input_float32` | FC 04 | IEEE 754 Float32 |

### Resolución de Tipo (resolve_device_type)

El backend usa tipos de schema (`trifasica`/`monofasica`) pero el gateway necesita el tipo interno para seleccionar el register map correcto:

```python
MODEL_TO_REGISTER_TYPE = {
    'SDM630MCT-V2': 'sdm630mct',   # FC 04, Float32
    'SDM630MCT':    'sdm630mct',
    'SDM630':       'sdm630mct',
    'EM340':        'trifasica',    # FC 03, INT
    'EM24':         'trifasica',
    'EM111':        'monofasica',
}
```

**Importante:** El campo `model` del dispositivo es el que determina qué protocolo usar, NO el `device_type`.

---

## Comunicación MQTT

### Topics

| Topic | Dirección | QoS | Descripción |
|-------|-----------|-----|-------------|
| `factory/{id}/telemetry` | Gateway → Backend | 1 | Batch de telemetría (~cada 5 min) |
| `factory/{id}/telemetry/ack` | Backend → Gateway | 1 | Confirmación de batch recibido |
| `factory/{id}/realtime` | Gateway → Backend | 0 | Datos en tiempo real (dashboard abierto) |
| `factory/{id}/realtime/control` | Backend → Gateway | 1 | Start/stop realtime |
| `factory/{id}/discovery` | Gateway → Backend | 1 | Resultados escaneo de red |
| `factory/{id}/commands` | Backend → Gateway | 1 | Comandos: add_device, remove_device, scan |

### Sesión Persistente

```python
client = mqtt.Client(
    callback_api_version=CallbackAPIVersion.VERSION2,
    client_id=f"gw_{FACTORY_ID[:8]}",   # Estable entre reinicios
    clean_session=False,                 # No perder mensajes QoS 1
)
```

Con `clean_session=False`, el broker (Mosquitto) mantiene la cola de mensajes QoS 1 mientras el gateway esté offline. Al reconectar, recibe los mensajes pendientes (ej: un `add_device` del backend).

### Comandos Soportados

| Comando | Payload | Acción |
|---------|---------|--------|
| `add_device` | `{device: {device_id, name, model, host, ...}}` | Añade dispositivo y guarda config |
| `remove_device` | `{device_id: "uuid"}` | Elimina dispositivo por UUID |
| `scan_network` | `{}` | Trigger escaneo de red |
| `start_realtime` | `{}` | Activa publicación realtime |
| `stop_realtime` | `{}` | Desactiva publicación realtime |

---

## Resiliencia y Edge Cases

| Escenario | Comportamiento |
|-----------|----------------|
| **Internet cae** | Batches se almacenan en SQLite → re-envío automático al reconectar |
| **Medidor apagado** | Log warning, se salta → sigue con los demás dispositivos |
| **Broker MQTT caído** | Reconexión automática con backoff exponencial |
| **Corte de luz** | Config escrito atómicamente (tmp + rename), sin corrupción |
| **ACK nunca llega** | `reset_stale_sent()` cada 60s → reintenta envío |
| **Dos instancias main.py** | Mismo `client_id` → broker desconecta una (evitar manualmente) |
| **Dispositivo no confirmado** | Se lee pero NO se publica telemetría (gating) |
| **Config.json cambia** | `SIGHUP` → hot-reload sin reiniciar el proceso |
| **Datos del buffer > 7 días** | `cleanup_old()` los borra (safety valve) |

---

## Despliegue en Producción

### Systemd Service

Crear `/etc/systemd/system/voltio-gateway.service`:

```ini
[Unit]
Description=Voltio Gateway - Industrial Energy Meter Agent
After=network-online.target mosquitto.service
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/fpsaver/gateway
ExecStart=/usr/bin/python3 src/main.py
Restart=always
RestartSec=10
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable voltio-gateway
sudo systemctl start voltio-gateway
sudo journalctl -u voltio-gateway -f   # Ver logs
```

### Panel Web como Servicio

```ini
[Unit]
Description=Voltio Gateway Config Panel
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/fpsaver/gateway
ExecStart=/usr/bin/python3 src/web_config.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Checklist de Despliegue

- [ ] Configurar `config.json` con el `factory_id` correcto
- [ ] Configurar MQTT con host, credenciales y TLS del servidor de producción
- [ ] Configurar rango de IPs de escaneo (subnet de medidores)
- [ ] Instalar dependencias: `pip install -r requirements.txt`
- [ ] Crear servicios systemd
- [ ] Verificar con `systemctl status voltio-gateway`
- [ ] Comprobar desde el panel web: `http://[IP]:8080`
