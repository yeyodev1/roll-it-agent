#!/usr/bin/env bash
# Deja el agente arrancando solo al iniciar sesión: LaunchAgent en macOS, systemd de usuario o cron en Linux.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_DIR="$(dirname "$(command -v node)")"
mkdir -p "$DIR/logs"

if [ "$(uname)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/ec.bakano.rollit-agente.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ec.bakano.rollit-agente</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/iniciar.sh</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODE_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$DIR/logs/servicio.log</string>
  <key>StandardErrorPath</key><string>$DIR/logs/servicio.log</string>
</dict>
</plist>
PLIST
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "Listo: el agente arranca solo al iniciar sesión (LaunchAgent)."
elif command -v systemctl >/dev/null 2>&1; then
  UNIT="$HOME/.config/systemd/user/rollit-agente.service"
  mkdir -p "$(dirname "$UNIT")"
  cat > "$UNIT" <<UNIT
[Unit]
Description=Roll It agente de ventas
After=network-online.target

[Service]
WorkingDirectory=$DIR
Environment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin
ExecStart=/bin/bash $DIR/iniciar.sh
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now rollit-agente.service
  echo "Listo: servicio de usuario rollit-agente activo."
  echo "Para que corra sin sesión abierta: sudo loginctl enable-linger $USER"
else
  (crontab -l 2>/dev/null | grep -v rollit-agente; echo "@reboot PATH=$NODE_DIR:/usr/bin:/bin /bin/bash $DIR/iniciar.sh >> $DIR/logs/servicio.log 2>&1 # rollit-agente") | crontab -
  nohup /bin/bash "$DIR/iniciar.sh" >> "$DIR/logs/servicio.log" 2>&1 &
  echo "Listo: agregado a cron (@reboot) y arrancado."
fi
