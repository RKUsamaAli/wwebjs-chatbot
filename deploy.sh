#!/usr/bin/env bash
#
# deploy.sh — provision + deploy the WhatsApp Web standalone app on an Ubuntu VPS
# (Hostinger KVM VPS or any root Linux box).
#
# Safe to re-run: it installs system deps only when missing, then rebuilds and
# restarts the app. Run as root from the `wwebjs-standalone` directory:
#
#     chmod +x deploy.sh
#     ./deploy.sh                       # http://<server-ip>:3000
#     DOMAIN=chat.example.com ./deploy.sh   # also sets up Nginx + free SSL
#
# Configurable via env vars (see the Config block below).
#
set -euo pipefail

# ─────────────────────────────── Config ───────────────────────────────
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")" && pwd)}"   # the wwebjs-standalone dir
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"

DATA_DIR="${DATA_DIR:-/root/wweb-data}"      # persistent DB lives here
PORT="${PORT:-3000}"
DOMAIN="${DOMAIN:-}"                          # e.g. chat.example.com (empty = skip Nginx/SSL)
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-admin@${DOMAIN:-example.com}}"
PM2_NAME="${PM2_NAME:-wweb}"
BUILD_FRONTEND="${BUILD_FRONTEND:-1}"        # set 0 if you upload frontend/dist yourself
NODE_MAJOR="${NODE_MAJOR:-20}"

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run as root (sudo ./deploy.sh)"
[ -d "$BACKEND_DIR" ] && [ -d "$FRONTEND_DIR" ] || die "Run this from the wwebjs-standalone directory"

# ───────────────────────── 1. System packages ─────────────────────────
log "Installing system dependencies (Node, Chrome, libs, PM2)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y

if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

# Google Chrome stable is the most reliable browser for Puppeteer on Ubuntu.
if ! command -v google-chrome-stable >/dev/null; then
  log "Installing Google Chrome stable…"
  TMP_DEB="$(mktemp --suffix=.deb)"
  curl -fsSL -o "$TMP_DEB" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y "$TMP_DEB" || apt-get -f install -y
  rm -f "$TMP_DEB"
fi
CHROME_PATH="$(command -v google-chrome-stable || true)"

# Extra libraries Chromium/Chrome needs when running headless.
apt-get install -y \
  ca-certificates fonts-liberation \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 \
  libpangocairo-1.0-0 libpango-1.0-0 libgtk-3-0 2>/dev/null || \
apt-get install -y \
  ca-certificates fonts-liberation \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
  libpangocairo-1.0-0 libpango-1.0-0 libgtk-3-0

command -v pm2 >/dev/null || npm i -g pm2

# ───────────────────────── 2. Swap (low-RAM VPS) ──────────────────────
TOTAL_RAM_MB="$(free -m | awk '/^Mem:/{print $2}')"
if [ "$TOTAL_RAM_MB" -lt 6000 ] && ! swapon --show | grep -q '/swapfile'; then
  log "Adding 2G swap (RAM is ${TOTAL_RAM_MB}MB) — protects against Chromium spikes…"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ───────────────────────── 3. Backend .env ────────────────────────────
mkdir -p "$DATA_DIR"
ENV_FILE="$BACKEND_DIR/.env"
SERVER_IP="$(curl -fsS --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
if [ -n "$DOMAIN" ]; then ORIGIN="https://$DOMAIN"; else ORIGIN="http://${SERVER_IP}:${PORT}"; fi

if [ ! -f "$ENV_FILE" ]; then
  log "Writing $ENV_FILE…"
  cat > "$ENV_FILE" <<EOF
PORT=${PORT}
NODE_ENV=production
DATABASE_URL=file:${DATA_DIR}/app.db
CORS_ORIGIN=${ORIGIN}
PUPPETEER_EXECUTABLE_PATH=${CHROME_PATH}
EOF
else
  warn "$ENV_FILE already exists — leaving it untouched (delete it to regenerate)."
fi

# ───────────────────────── 4. Build frontend ──────────────────────────
if [ "$BUILD_FRONTEND" = "1" ]; then
  log "Building Angular frontend…"
  cd "$FRONTEND_DIR"
  npm install
  npm run build         # outputs to frontend/dist/frontend/browser (served by backend)
else
  warn "BUILD_FRONTEND=0 — assuming frontend/dist was uploaded already."
  [ -d "$FRONTEND_DIR/dist/frontend/browser" ] || die "frontend/dist/frontend/browser not found"
fi

# ───────────────────────── 5. Build + migrate backend ─────────────────
log "Building backend and applying migrations…"
cd "$BACKEND_DIR"
npm install
npm run build           # runs `prisma generate` then tsc
./node_modules/.bin/prisma migrate deploy

# ───────────────────────── 6. Start with PM2 ──────────────────────────
log "Starting app with PM2…"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  pm2 start npm --name "$PM2_NAME" -- start
fi
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# ───────────────────────── 7. Nginx + SSL (optional) ──────────────────
if [ -n "$DOMAIN" ]; then
  log "Configuring Nginx reverse proxy for $DOMAIN…"
  command -v nginx >/dev/null || apt-get install -y nginx
  cat > "/etc/nginx/sites-available/${DOMAIN}.conf" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    client_max_body_size 100M;          # allow media uploads

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;      # WebSocket (Socket.io)
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
    }
}
EOF
  ln -sf "/etc/nginx/sites-available/${DOMAIN}.conf" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx

  log "Obtaining Let's Encrypt SSL certificate…"
  command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" --redirect || \
    warn "Certbot failed — make sure $DOMAIN's DNS A record points to ${SERVER_IP} and re-run."
fi

# ───────────────────────────── Done ───────────────────────────────────
log "Deploy complete 🎉"
if [ -n "$DOMAIN" ]; then
  echo "   Open: https://${DOMAIN}  → scan the WhatsApp QR to connect."
else
  echo "   Open: http://${SERVER_IP}:${PORT}  → scan the WhatsApp QR to connect."
  echo "   (Tip: pass DOMAIN=your.domain ./deploy.sh to add Nginx + HTTPS.)"
fi
echo "   Logs:    pm2 logs ${PM2_NAME}"
echo "   Restart: pm2 restart ${PM2_NAME}"
echo "   Persist: DB at ${DATA_DIR} • WhatsApp session at ${BACKEND_DIR}/.wwebjs_auth — back these up."
