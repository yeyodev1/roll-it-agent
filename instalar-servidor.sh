#!/usr/bin/env bash
# Deja el agente de los 3 locales corriendo 24/7 en un servidor Ubuntu/Debian que entra a la red
# ZeroTier de SmartMenu. Así no depende de ninguna PC de Bakano ni del local.
#
#   sudo SYNC_KEY=... SMARTMENU_KEY=... bash instalar-servidor.sh
#   (opcional) CF_TUNNEL_TOKEN=...  instala además el túnel de Cloudflare para que el equipo entre a SmartMenu.
#
# Se puede correr de nuevo para actualizar: hace git pull, recompila y reinicia.
set -euo pipefail
: "${SYNC_KEY:?Falta SYNC_KEY (el SYNC_API_KEY del back)}"
: "${SMARTMENU_KEY:?Falta SMARTMENU_KEY (la clave numérica de SmartMenu)}"

ZT_NETWORK=154a350c86085a90 # "ROLL IT NUEVA"
API_URL=https://roll-it-backapp.vercel.app/api
REPO=https://github.com/yeyodev1/roll-it-agent
APP=/opt/roll-it-agent
DATA=/var/lib/roll-it
# IP de SmartMenu de cada local dentro de ZeroTier (confirmadas por la dirección que trae el reporte).
BRANCHES="villa-club=10.221.11.156 marbol=10.221.11.206 cuenca=10.221.11.140"

apt-get update -qq && apt-get install -y -qq curl git ca-certificates >/dev/null

# 1. ZeroTier: la red es privada, el admin tiene que autorizar este nodo una vez.
command -v zerotier-cli >/dev/null || curl -fsSL https://install.zerotier.com | bash
zerotier-cli join "$ZT_NETWORK" >/dev/null
NODE_ID="$(zerotier-cli info | awk '{print $3}')"

# 2. Node y el agente (sin navegador: baja el reporte por HTTP).
if ! node -v 2>/dev/null | grep -qE '^v(2[0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null
fi
[ -d "$APP/.git" ] || git clone -q "$REPO" "$APP"
git -C "$APP" pull -q --ff-only
(cd "$APP" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --silent --allow-remote=all && npm run build --silent)

# 3. Una carpeta y un config.json por local.
id rollit >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin rollit
for pair in $BRANCHES; do
  slug="${pair%%=*}" ip="${pair##*=}"
  mkdir -p "$DATA/$slug/entrada"
  cat > "$DATA/$slug/config.json" <<JSON
{
  "apiUrl": "$API_URL",
  "syncKey": "$SYNC_KEY",
  "branch": "$slug",
  "smartmenuUrl": "http://$ip/SMARTMENU/login.html",
  "smartmenuKey": "$SMARTMENU_KEY",
  "intervalMinutes": 2,
  "downloadsDir": "$DATA/$slug/entrada",
  "mode": "auto",
  "recipeUrl": ""
}
JSON
done
chown -R rollit:rollit "$DATA" && chmod 700 "$DATA"

# 4. Un servicio por local: si uno falla (local apagado) los otros siguen.
cat > /etc/systemd/system/roll-it-agent@.service <<UNIT
[Unit]
Description=Roll It agente de ventas (%i)
After=network-online.target zerotier-one.service
Wants=network-online.target

[Service]
User=rollit
Environment=ROLLIT_AGENT_HOME=$DATA/%i
Environment=TZ=America/Guayaquil
ExecStart=/usr/bin/node $APP/dist/index.js auto
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
for pair in $BRANCHES; do systemctl enable -q "roll-it-agent@${pair%%=*}" && systemctl restart "roll-it-agent@${pair%%=*}"; done

# 5. Opcional: túnel de Cloudflare (los hostnames y el Access se configuran en el panel de Zero Trust).
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
  if ! command -v cloudflared >/dev/null; then
    curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    dpkg -i /tmp/cloudflared.deb >/dev/null
  fi
  cloudflared service install "$CF_TUNNEL_TOKEN" 2>/dev/null || systemctl restart cloudflared
fi

echo
echo "Nodo ZeroTier de este servidor: $NODE_ID"
echo "Estado en la red: $(zerotier-cli listnetworks | grep "$ZT_NETWORK" || echo 'sin unirse')"
echo "Si dice ACCESS_DENIED, el admin de ZeroTier tiene que autorizar $NODE_ID en la red $ZT_NETWORK."
echo "Logs: journalctl -u 'roll-it-agent@*' -f   ·   $DATA/<local>/logs/"
