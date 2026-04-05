#!/bin/bash
# ============================================
# Voltio — Generate MQTT TLS Certificates
# Self-signed CA + Server certificate
# ============================================
set -e

CERT_DIR="$(dirname "$0")/../mosquitto/certs"
SERVER_IP="${1:-46.225.137.160}"

echo "╔═══════════════════════════════════════════╗"
echo "║  Voltio — MQTT TLS Certificate Generator  ║"
echo "║  Server IP: ${SERVER_IP}                   "
echo "╚═══════════════════════════════════════════╝"

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

# 1. Certificate Authority (CA)
echo ""
echo "→ Generating CA key and certificate..."
openssl genrsa -out ca.key 2048
openssl req -new -x509 \
    -key ca.key \
    -out ca.crt \
    -days 3650 \
    -subj "/C=ES/ST=Malaga/O=Voltio/CN=Voltio MQTT CA"

# 2. Server Certificate
echo "→ Generating server key and CSR..."
openssl genrsa -out server.key 2048

# Create SAN config for IP-based certificate
cat > server-san.cnf <<EOF
[req]
default_bits = 2048
prompt = no
distinguished_name = dn
req_extensions = v3_req

[dn]
C = ES
ST = Malaga
O = Voltio
CN = ${SERVER_IP}

[v3_req]
subjectAltName = @alt_names

[alt_names]
IP.1 = ${SERVER_IP}
IP.2 = 127.0.0.1
DNS.1 = localhost
EOF

openssl req -new \
    -key server.key \
    -out server.csr \
    -config server-san.cnf

# 3. Sign server certificate with CA
echo "→ Signing server certificate with CA..."
openssl x509 -req \
    -in server.csr \
    -CA ca.crt \
    -CAkey ca.key \
    -CAcreateserial \
    -out server.crt \
    -days 3650 \
    -extensions v3_req \
    -extfile server-san.cnf

# 4. Cleanup
rm -f server.csr server-san.cnf ca.srl

# 5. Set permissions
chmod 644 ca.crt server.crt
chmod 600 ca.key server.key

echo ""
echo "✅ Certificates generated successfully!"
echo ""
echo "Files created in: $CERT_DIR"
ls -la "$CERT_DIR"
echo ""
echo "📋 Next steps:"
echo "   1. Copy ca.crt to the Raspberry Pi gateway for TLS verification"
echo "   2. The gateway config should set:"
echo "      \"tls\": { \"enabled\": true, \"ca_cert\": \"/path/to/ca.crt\" }"
echo ""
