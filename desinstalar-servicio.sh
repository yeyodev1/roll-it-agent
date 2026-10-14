#!/usr/bin/env bash
# Detiene el agente y quita el arranque automático.
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/datos" && touch "$DIR/datos/detener"
if [ "$(uname)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/ec.bakano.rollit-agente.plist"
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
elif command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now rollit-agente.service 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/rollit-agente.service"
fi
crontab -l 2>/dev/null | grep -v rollit-agente | crontab - 2>/dev/null || true
[ -f "$DIR/datos/agente.lock" ] && kill "$(cat "$DIR/datos/agente.lock")" 2>/dev/null
echo "Listo: el agente se detuvo y ya no arranca solo."
