# 🚀 Voltio — Checklist de Producción

Todo lo que hay que hacer antes de desplegar en fábricas reales.

---

## 1. Servidor (VPS / Cloud)

### Mosquitto MQTT Broker
- [ ] Instalar Mosquitto en el servidor: `apt install mosquitto mosquitto-clients`
- [ ] Habilitar TLS con certificado (Let's Encrypt o autofirmado)
- [ ] Cambiar puerto de `1883` → `8883` (TLS)
- [ ] Crear usuario por fábrica (no usar `backend_service` para los gateways)
  ```bash
  sudo mosquitto_passwd -c /etc/mosquitto/passwd fabrica_malaga_01
  sudo mosquitto_passwd    /etc/mosquitto/passwd fabrica_barcelona_01
  ```
- [ ] Configurar ACL para aislar fábricas (cada gateway solo accede a sus topics)
  ```
  # /etc/mosquitto/acl
  user fabrica_malaga_01
  topic readwrite factory/91ddc8de-xxxx/#

  user backend_service
  topic readwrite factory/#
  ```
- [ ] Reiniciar Mosquitto: `sudo systemctl restart mosquitto`

### Backend Node.js
- [ ] Variables de entorno de producción (`.env.production`)
- [ ] PostgreSQL con TimescaleDB en producción
- [ ] Aplicar migración `010_fix_device_unique.sql`
- [ ] Configurar `MQTT_BACKEND_PASSWORD` en el entorno
- [ ] Habilitar TLS en la conexión MQTT del backend (`backend/src/config/mqtt.js`)

### Base de Datos
- [ ] Ejecutar todas las migraciones pendientes
- [ ] Configurar retention policies de TimescaleDB (datos brutos: 1 año, CAGG: indefinido)
- [ ] Backups automáticos con `pg_dump` / cron

---

## 2. Gateway (Mini PC en la fábrica)

### Configuración MQTT (`gateway/config/config.json`)
- [ ] Cambiar `broker_host` → IP o dominio del servidor de producción
- [ ] Cambiar `broker_port` → `8883` (si TLS habilitado)
- [ ] Activar TLS: `"tls": { "enabled": true }`
- [ ] Si es certificado autofirmado → copiar `ca.crt` al mini PC y configurar ruta
- [ ] Cambiar `username` → usuario específico de la fábrica
- [ ] Cambiar `password` → contraseña segura

### Configuración General
- [ ] Verificar `factory_id` → debe coincidir con el UUID de la fábrica en el backend
- [ ] Configurar rango de IPs del escaneo → subred de los medidores
- [ ] Ajustar `batch_seconds` → 300 (5 min) para producción
- [ ] Ajustar `batch_mode` → `"average"` para datos precisos de consumo

### Systemd Services
- [ ] Crear `/etc/systemd/system/voltio-gateway.service`:
  ```ini
  [Unit]
  Description=Voltio Gateway
  After=network-online.target
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
- [ ] Crear `/etc/systemd/system/voltio-web-config.service`:
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
- [ ] Habilitar servicios:
  ```bash
  sudo systemctl daemon-reload
  sudo systemctl enable voltio-gateway voltio-web-config
  sudo systemctl start voltio-gateway voltio-web-config
  ```

### Red
- [ ] Asignar IP estática al mini PC
- [ ] Verificar que el mini PC alcanza los medidores (ping + modbus)
- [ ] Verificar que el mini PC alcanza el broker MQTT (telnet server 8883)
- [ ] (Futuro) Mover medidores a subred dedicada `10.10.x.x`

---

## 3. Hardware (Por cada medidor)

- [ ] Verificar que el conversor RS485-TCP (USR-TCP232) tiene IP correcta
- [ ] Verificar que el CT (transformador de corriente) está bien conectado a L1/L2/L3
- [ ] Verificar lectura desde el mini PC: voltaje entre 220-245V
- [ ] Confirmar el modelo detectado (SDM630MCT vs EM340 vs EM111)
- [ ] Registrar el dispositivo desde el dashboard web de Voltio

---

## 4. Seguridad

- [ ] Contraseñas MQTT únicas por fábrica (no reutilizar entre fábricas)
- [ ] TLS habilitado en MQTT (nunca texto plano en internet)
- [ ] Panel web (`web_config.py`) solo accesible desde la LAN de la fábrica
- [ ] Firewall: solo abrir puertos necesarios en el mini PC (8080 LAN, 8883 saliente)
- [ ] Las credenciales del `config.json` NO deben subirse a Git

---

## 5. Validación Post-Despliegue

- [ ] El gateway arranca y conecta al MQTT → ver logs: `[MQTT] Connected`
- [ ] Los medidores se leen correctamente → voltaje ~230V
- [ ] Los batches se envían y reciben ACK → `[ACK] Batch confirmed`
- [ ] Los datos aparecen en el dashboard web de Voltio
- [ ] El realtime funciona al abrir el dashboard (datos cada 5s)
- [ ] Apagar y encender el mini PC → los servicios arrancan solos
- [ ] Desconectar internet 5 min → reconectar → datos buffereados se envían
- [ ] El panel web es accesible desde `http://[IP-mini-pc]:8080`
