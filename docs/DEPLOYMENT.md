# 🚀 Voltio — Manual de Despliegue en Producción

> **Servidor:** Hetzner VPS — `46.225.137.160`  
> **SO:** Ubuntu 22.04+  
> **Stack:** Docker Compose  
> **Última actualización:** Abril 2026

---

## Índice

1. [Arquitectura](#1-arquitectura)
2. [Requisitos Previos](#2-requisitos-previos)
3. [Setup Inicial del Servidor](#3-setup-inicial-del-servidor)
4. [Configuración Post-Setup](#4-configuración-post-setup)
5. [Arrancar el Stack](#5-arrancar-el-stack)
6. [Inicializar Base de Datos](#6-inicializar-base-de-datos)
7. [Servicios y Puertos](#7-servicios-y-puertos)
8. [CI/CD — Despliegue Automático](#8-cicd--despliegue-automático)
9. [Operaciones de Mantenimiento](#9-operaciones-de-mantenimiento)
10. [Troubleshooting](#10-troubleshooting)
11. [Seguridad — Próximos Pasos](#11-seguridad--próximos-pasos)

---

## 1. Arquitectura

```
                    ┌─────────────────────────────────────────────┐
                    │              Hetzner VPS                    │
                    │           46.225.137.160                     │
                    │                                             │
  Usuarios ──────▶  │  :80 ──▶ Nginx ──┬──▶ Frontend (Vue SPA)   │
                    │                  ├──▶ Backend  (Node.js)    │
                    │                  └──▶ WebSocket (Socket.io) │
                    │                                             │
  RPi Gateway ───▶  │  :1883 ──▶ Mosquitto MQTT                   │
                    │                    ▲                         │
                    │                    │                         │
                    │            Backend ┘                         │
                    │                                             │
                    │  PostgreSQL + TimescaleDB (interno)          │
                    │                                             │
                    │  :5050  ──▶ pgAdmin                         │
                    │  :9443  ──▶ Portainer                       │
                    └─────────────────────────────────────────────┘
```

### Contenedores Docker

| Contenedor | Imagen | Función |
|---|---|---|
| `voltio_postgres` | `timescale/timescaledb:latest-pg16` | Base de datos con soporte de series temporales |
| `voltio_mosquitto` | `eclipse-mosquitto:2` | Broker MQTT para comunicación con gateways |
| `voltio_backend` | Build desde `./backend/Dockerfile` | API REST + WebSocket + cliente MQTT |
| `voltio_frontend` | Build desde `./frontend/Dockerfile` | Vue 3 SPA servida por Nginx interno |
| `voltio_nginx` | `nginx:alpine` | Reverse proxy — enruta tráfico HTTP |
| `voltio_pgadmin` | `dpage/pgadmin4:latest` | Administración visual de PostgreSQL |
| `voltio_portainer` | `portainer/portainer-ce:latest` | Gestión visual de contenedores Docker |

---

## 2. Requisitos Previos

- **Servidor Hetzner** con Ubuntu 22.04+ (o cualquier VPS con Ubuntu)
- **Acceso SSH** como `root`
- **Repositorio** en GitHub: `github.com/diegolagalera/voltio`
- **Claves API** (opcionales pero recomendadas):
  - ESIOS API Key (precios electricidad)
  - OpenAI API Key (funciones IA)

---

## 3. Setup Inicial del Servidor

### 3.1. Primer acceso (desde Hetzner Rescue Mode)

Si el servidor está en **modo rescate** (prompt `root@rescue`), primero hay que instalar Ubuntu:

```bash
installimage
```

1. Seleccionar **Ubuntu 22.04** o **24.04**
2. Configurar hostname (ej: `voltio`)
3. Guardar y confirmar la instalación
4. Reiniciar: `reboot`

### 3.2. Conectar por SSH

```bash
ssh root@46.225.137.160
```

> **⚠️ Si aparece "REMOTE HOST IDENTIFICATION HAS CHANGED":**  
> Es normal después de reinstalar el OS. Ejecuta en tu Mac:
> ```bash
> ssh-keygen -R 46.225.137.160
> ```
> Y vuelve a conectar.

### 3.3. Ejecutar el script de setup

```bash
curl -fsSL https://raw.githubusercontent.com/diegolagalera/voltio/main/scripts/server-setup.sh | bash
```

El script automáticamente:
1. ✅ Actualiza el sistema
2. ✅ Instala Docker y Docker Compose
3. ✅ Instala utilidades (`git`, `curl`, `htop`, `fail2ban`)
4. ✅ Configura el firewall (UFW)
5. ✅ Clona el repositorio en `/opt/voltio`
6. ✅ Genera certificados MQTT (para TLS futuro)
7. ✅ Crea `.env.production` con secretos aleatorios

### 3.4. Guardar las credenciales

Al finalizar, el script muestra credenciales generadas:

```
Generated credentials:
├── SuperAdmin email:    admin@voltio.es
├── SuperAdmin password: <generado>
├── Postgres password:   <generado>
├── MQTT password:       <generado>
└── pgAdmin password:    <generado>
```

**🔐 ¡Guárdalas en un lugar seguro!** (gestor de contraseñas, 1Password, etc.)

Para consultarlas después:
```bash
cat /opt/voltio/.env.production
```

---

## 4. Configuración Post-Setup

### 4.1. Editar claves API

```bash
nano /opt/voltio/.env.production
```

Cambia estas líneas con tus claves reales:
```
ESIOS_API_KEY=tu_clave_esios_aqui
OPENAI_API_KEY=tu_clave_openai_aqui
```

Guardar: `Ctrl+O` → `Enter` → `Ctrl+X`

### 4.2. Configurar contraseña MQTT

El broker Mosquitto necesita que la contraseña esté en su propio archivo:

```bash
cd /opt/voltio
MQTT_PASS=$(grep MQTT_BACKEND_PASSWORD .env.production | cut -d= -f2)
docker run --rm -v $(pwd)/mosquitto/config:/mosquitto/config eclipse-mosquitto:2 \
  mosquitto_passwd -b /mosquitto/config/password_file backend_service "$MQTT_PASS"
```

---

## 5. Arrancar el Stack

### 5.1. Primer arranque (con build)

```bash
cd /opt/voltio
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### 5.2. Verificar que todos los contenedores están corriendo

```bash
docker compose -f docker-compose.prod.yml ps
```

Todos deben mostrar estado `Up` o `healthy`:

```
NAME                STATUS              PORTS
voltio_postgres     Up (healthy)        5432/tcp
voltio_mosquitto    Up (healthy)        0.0.0.0:1883->1883/tcp
voltio_backend      Up                  3000/tcp
voltio_frontend     Up                  80/tcp
voltio_nginx        Up                  0.0.0.0:80->80/tcp
voltio_pgadmin      Up                  0.0.0.0:5050->80/tcp
voltio_portainer    Up                  0.0.0.0:9443->9443/tcp
```

### 5.3. Ver logs

```bash
# Todos los servicios
docker compose -f docker-compose.prod.yml logs -f

# Solo un servicio específico
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f mosquitto
```

---

## 6. Inicializar Base de Datos

El proyecto usa **`node-pg-migrate`** para gestionar el schema. Las migraciones se ejecutan dentro del contenedor backend.

### 6.1. Ejecutar Migraciones (crear schema)

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec backend npm run migrate
```

Si dice `No migrations to run!`, el schema ya está actualizado.

### 6.2. Ejecutar Seed (crear SuperAdmin)

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec backend npm run seed
```

### 6.3. Verificar login

```bash
# Ver credenciales del SuperAdmin
grep SUPERADMIN /opt/voltio/.env.production
```

Abre `http://46.225.137.160` e inicia sesión con esas credenciales.

### 6.4. Comandos de migración disponibles

```bash
# Aplicar migraciones pendientes
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec backend npm run migrate

# Rollback última migración
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec backend npm run migrate:down

# Crear nueva migración (en desarrollo local)
cd backend && npm run migrate:create -- nombre-migracion
```

---

## 7. Servicios y Puertos

| Puerto | Servicio | URL | Descripción |
|--------|----------|-----|-------------|
| `80` | Nginx | `http://46.225.137.160` | App Voltio (frontend + API) |
| `1883` | Mosquitto | `mqtt://46.225.137.160:1883` | Broker MQTT para gateways RPi |
| `5050` | pgAdmin | `http://46.225.137.160:5050` | Administración de PostgreSQL |
| `9443` | Portainer | `https://46.225.137.160:9443` | Gestión de contenedores Docker |

### Configurar pgAdmin (primera vez)

1. Login con credenciales de `.env.production` (`PGADMIN_EMAIL` y `PGADMIN_PASSWORD`)
2. **Register** → **Server**:
   - **General** → Name: `Voltio`
   - **Connection**:
     - Host: `postgres`
     - Port: `5432`
     - Database: `fpsaver`
     - Username: `fpsaver_admin`
     - Password: el `POSTGRES_PASSWORD` de `.env.production`
     - ✅ Save password

### Configurar Portainer (primera vez)

1. Acceder a `https://46.225.137.160:9443`
2. Crear usuario admin (¡hazlo inmediatamente, caduca en minutos!)
3. Seleccionar **"Get Started"** → Environment local

> **Si Portainer muestra "timed out":**
> ```bash
> docker restart voltio_portainer
> ```
> Y accede inmediatamente.

### Firewall (UFW)

```bash
# Ver estado
ufw status verbose

# Puertos abiertos:
# 22/tcp   - SSH
# 80/tcp   - HTTP (Voltio App)
# 443/tcp  - HTTPS (futuro)
# 1883/tcp - MQTT (gateways)
# 5050/tcp - pgAdmin
# 9443/tcp - Portainer
```

---

## 8. CI/CD — Despliegue Automático

El repositorio incluye GitHub Actions (`.github/workflows/deploy.yml`) que despliega automáticamente al hacer push a `main`.

### 8.1. Configurar SSH Deploy Key

**En tu Mac:**
```bash
# Generar clave dedicada para deploy
ssh-keygen -t ed25519 -f ~/.ssh/voltio_deploy -C "voltio-deploy" -N ""

# Copiar la clave pública al servidor
ssh-copy-id -i ~/.ssh/voltio_deploy.pub root@46.225.137.160

# Ver la clave privada (copiar todo el output)
cat ~/.ssh/voltio_deploy
```

### 8.2. Añadir el Secret en GitHub

1. Ir a `github.com/diegolagalera/voltio/settings/secrets/actions`
2. **New repository secret**
3. Name: `SSH_PRIVATE_KEY`
4. Value: pegar la clave privada completa (incluye `-----BEGIN/END-----`)

### 8.3. Flujo de despliegue

```
git push origin main
       │
       ▼
GitHub Actions ──SSH──▶ Servidor
       │
       ├── git pull origin main
       ├── docker compose build --no-cache backend frontend
       ├── docker compose up -d
       ├── npm run migrate (node-pg-migrate)
       ├── Limpiar imágenes antiguas
       └── Health check: curl /api/health
```

### 8.4. Trigger manual

También puedes ejecutar el deploy manualmente desde GitHub:
- Actions → "Deploy to Production" → "Run workflow"

---

## 9. Operaciones de Mantenimiento

### Reiniciar un servicio

```bash
cd /opt/voltio
docker compose -f docker-compose.prod.yml restart backend
docker compose -f docker-compose.prod.yml restart mosquitto
```

### Reiniciar todo el stack

```bash
cd /opt/voltio
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

### Actualizar manualmente (sin CI/CD)

```bash
cd /opt/voltio
git pull origin main
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### Ver uso de recursos

```bash
# Recursos por contenedor
docker stats

# Uso de disco Docker
docker system df

# Recursos del sistema
htop
```

### Limpiar imágenes/volúmenes no usados

```bash
# Imágenes sin usar
docker image prune -f

# Limpieza completa (⚠️ cuidado)
docker system prune -f
```

### Backup de la base de datos

```bash
# Crear backup
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U fpsaver_admin -d fpsaver > backup_$(date +%Y%m%d_%H%M%S).sql

# Restaurar backup
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U fpsaver_admin -d fpsaver < backup_YYYYMMDD_HHMMSS.sql
```

### Ver logs de Mosquitto

```bash
docker compose -f docker-compose.prod.yml exec mosquitto cat /mosquitto/log/mosquitto.log
```

---

## 10. Troubleshooting

### Docker no arranca (`docker.service not found`)

Si ves `root@rescue` en el prompt, estás en modo rescate. Necesitas instalar Ubuntu:
```bash
installimage  # Seleccionar Ubuntu → reboot
```

### Mosquitto falla al arrancar

Verificar logs:
```bash
docker logs voltio_mosquitto
```

Causas comunes:
- **Certificados TLS faltantes:** Si usas TLS en `mosquitto.conf` pero no existen los certs
- **Password file corrupto:** Regenerar con `mosquitto_passwd`
- **Permisos:** Los archivos de config deben ser legibles

### No puedo hacer login en la app

```bash
# Verificar que existe el usuario
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U fpsaver_admin -d fpsaver -c "SELECT email, role FROM users;"

# Si el password_hash contiene 'placeholder', borrar y re-seedear
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U fpsaver_admin -d fpsaver -c "DELETE FROM users WHERE password_hash LIKE '%placeholder%';"

docker compose -f docker-compose.prod.yml --env-file .env.production exec backend node src/db/seed.js
```

### Portainer muestra "timed out"

```bash
docker restart voltio_portainer
# Acceder inmediatamente a https://46.225.137.160:9443
```

### SSH "REMOTE HOST IDENTIFICATION HAS CHANGED"

```bash
ssh-keygen -R 46.225.137.160
ssh root@46.225.137.160
```

### Un contenedor se reinicia constantemente

```bash
# Ver logs del contenedor problemático
docker logs voltio_backend --tail 50

# Ver eventos
docker events --filter container=voltio_backend
```

---

## 11. Seguridad — Próximos Pasos

### Pendiente

- [ ] **TLS para MQTT:** Generar certificados autofirmados y habilitar listener 8883
- [ ] **HTTPS para la web:** Configurar dominio + Let's Encrypt (Certbot)
- [ ] **Restringir pgAdmin:** Volver a `127.0.0.1:5050` y usar SSH tunnel
- [ ] **Fail2ban:** Verificar que está activo (`systemctl status fail2ban`)
- [ ] **Backups automáticos:** Configurar cron job para pg_dump diario
- [ ] **Monitoring:** Añadir Prometheus + Grafana (opcional)

### Acceso por SSH Tunnel (para servicios internos)

Si decides restringir pgAdmin/Portainer al localhost:

```bash
# Desde tu Mac — túnel SSH para pgAdmin
ssh -L 5050:127.0.0.1:5050 root@46.225.137.160

# Abrir http://localhost:5050 en tu navegador
```

---

## Archivos Clave

| Archivo | Descripción |
|---------|-------------|
| `docker-compose.prod.yml` | Definición de todos los servicios Docker |
| `.env.production` | Variables de entorno (secretos) — **solo en servidor** |
| `nginx/voltio.conf` | Config de Nginx reverse proxy |
| `mosquitto/config/mosquitto.conf` | Config del broker MQTT |
| `mosquitto/config/password_file` | Credenciales MQTT (hasheadas) |
| `mosquitto/config/acl_file` | Permisos ACL del broker MQTT |
| `scripts/server-setup.sh` | Script de setup inicial del servidor |
| `.github/workflows/deploy.yml` | GitHub Actions — deploy automático |
| `backend/Dockerfile` | Build del backend Node.js |
| `frontend/Dockerfile` | Build del frontend Vue + Nginx |
