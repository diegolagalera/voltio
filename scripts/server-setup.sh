#!/bin/bash
# ============================================
# Voltio — Server Initial Setup Script
# Target: Ubuntu 22.04+ (Hetzner VPS)
# Run as root: bash server-setup.sh
# ============================================
set -e

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

SERVER_IP="46.225.137.160"
REPO_URL="https://github.com/diegolagalera/voltio.git"
APP_DIR="/opt/voltio"

echo "╔═══════════════════════════════════════════╗"
echo "║     Voltio — Server Setup                 ║"
echo "║     Server: ${SERVER_IP}                   "
echo "╚═══════════════════════════════════════════╝"

# ── 1. System Update ─────────────────────────
echo ""
echo "→ [1/8] Updating system packages..."
apt update && apt upgrade -y -o Dpkg::Options::="--force-confold" -o Dpkg::Options::="--force-confdef"

# ── 2. Install Docker ────────────────────────
echo ""
echo "→ [2/8] Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "   ✅ Docker installed"
else
    echo "   ⏭️  Docker already installed"
fi

# ── 3. Install Docker Compose Plugin ─────────
echo ""
echo "→ [3/8] Installing Docker Compose plugin..."
if ! docker compose version &> /dev/null; then
    apt install -y docker-compose-plugin
    echo "   ✅ Docker Compose installed"
else
    echo "   ⏭️  Docker Compose already installed"
fi

# ── 4. Install useful tools ──────────────────
echo ""
echo "→ [4/8] Installing utilities..."
apt install -y git curl wget htop ufw fail2ban

# ── 5. Configure Firewall ────────────────────
echo ""
echo "→ [5/8] Configuring firewall (ufw)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS (future)'
ufw allow 8883/tcp comment 'MQTT TLS'
ufw allow 9443/tcp comment 'Portainer'
ufw allow 5050/tcp comment 'pgAdmin'
echo "y" | ufw enable
ufw status verbose
echo "   ✅ Firewall configured"

# ── 6. Clone Repository ─────────────────────
echo ""
echo "→ [6/8] Cloning repository..."
if [ -d "$APP_DIR" ]; then
    echo "   ⏭️  $APP_DIR already exists, pulling latest..."
    cd "$APP_DIR" && git pull origin main
else
    git clone "$REPO_URL" "$APP_DIR"
    echo "   ✅ Repository cloned to $APP_DIR"
fi

cd "$APP_DIR"

# ── 7. Generate MQTT Certificates ────────────
echo ""
echo "→ [7/8] Generating MQTT TLS certificates..."
if [ ! -f "mosquitto/certs/server.crt" ]; then
    chmod +x scripts/generate-mqtt-certs.sh
    bash scripts/generate-mqtt-certs.sh "$SERVER_IP"
else
    echo "   ⏭️  Certificates already exist"
fi

# ── 8. Create .env.production ────────────────
echo ""
echo "→ [8/8] Environment configuration..."
if [ ! -f ".env.production" ]; then
    # Generate strong random secrets
    JWT_ACCESS=$(openssl rand -hex 32)
    JWT_REFRESH=$(openssl rand -hex 32)
    PG_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
    SA_PASS=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)
    MQTT_PASS=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)
    PGADMIN_PASS=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)

    cat > .env.production <<EOF
# ============================================
# Voltio — Production Environment
# Generated: $(date -Iseconds)
# Server: ${SERVER_IP}
# ============================================

NODE_ENV=production

# PostgreSQL / TimescaleDB
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=fpsaver
POSTGRES_USER=fpsaver_admin
POSTGRES_PASSWORD=${PG_PASS}

# MQTT Broker
MQTT_HOST=mosquitto
MQTT_PORT=1883
MQTT_BACKEND_PASSWORD=${MQTT_PASS}

# JWT Secrets
JWT_ACCESS_SECRET=${JWT_ACCESS}
JWT_REFRESH_SECRET=${JWT_REFRESH}
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Backend
BACKEND_PORT=3000

# SuperAdmin
SUPERADMIN_EMAIL=admin@voltio.es
SUPERADMIN_PASSWORD=${SA_PASS}

# ESIOS API (Spanish Electricity Market)
ESIOS_API_KEY=REPLACE_WITH_YOUR_ESIOS_KEY

# OpenAI
OPENAI_API_KEY=REPLACE_WITH_YOUR_OPENAI_KEY

# pgAdmin
PGADMIN_EMAIL=admin@voltio.es
PGADMIN_PASSWORD=${PGADMIN_PASS}
EOF

    echo "   ✅ .env.production created with generated secrets"
    echo ""
    echo "   ⚠️  IMPORTANT: Edit .env.production to add your API keys:"
    echo "      nano $APP_DIR/.env.production"
    echo ""
    echo "   Generated credentials:"
    echo "   ├── SuperAdmin email:    admin@voltio.es"
    echo "   ├── SuperAdmin password: ${SA_PASS}"
    echo "   ├── Postgres password:   ${PG_PASS}"
    echo "   ├── MQTT password:       ${MQTT_PASS}"
    echo "   └── pgAdmin password:    ${PGADMIN_PASS}"
    echo ""
    echo "   🔐 Save these credentials somewhere safe!"
else
    echo "   ⏭️  .env.production already exists"
fi

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║  ✅ Server setup complete!                ║"
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit your API keys:"
echo "     nano $APP_DIR/.env.production"
echo ""
echo "  2. Update MQTT password file (use the generated MQTT_BACKEND_PASSWORD):"
echo "     docker run -it --rm -v $APP_DIR/mosquitto/config:/mosquitto/config eclipse-mosquitto:2 \\"
echo "       mosquitto_passwd -b /mosquitto/config/password_file backend_service <MQTT_PASSWORD>"
echo ""
echo "  3. Start the stack:"
echo "     cd $APP_DIR"
echo "     docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build"
echo ""
echo "  4. Run database seed (first time only):"
echo "     docker compose -f docker-compose.prod.yml exec backend node src/db/seed.js"
echo ""
echo "  5. Run database migrations:"
echo "     for f in backend/src/db/migrations/*.sql; do"
echo "       docker compose -f docker-compose.prod.yml exec -T postgres psql -U fpsaver_admin -d fpsaver < \$f"
echo "     done"
echo ""
echo "  6. Verify:"
echo "     curl http://${SERVER_IP}/api/health"
echo "     Open http://${SERVER_IP} in browser"
echo ""
