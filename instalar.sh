#!/usr/bin/env bash
# Instala el agente en macOS o Linux. Requiere Node.js 20 o más nuevo.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Falta Node.js 20 o más nuevo. Instálalo desde https://nodejs.org/es/download (versión LTS) y vuelve a correr ./instalar.sh"
  exit 1
fi

echo "[1/4] Instalando dependencias..."
npm install --no-audit --no-fund
echo "[2/4] Descargando Chromium..."
if [ "$(uname)" = "Linux" ]; then
  # En Linux Chromium necesita librerías del sistema; --with-deps las instala (pide sudo).
  npx playwright install --with-deps chromium || npx playwright install chromium
else
  npx playwright install chromium
fi
echo "[3/4] Compilando..."
npm run build

if [ -f config.json ]; then
  echo "[4/4] config.json ya existe, no lo toco."
else
  cp config.example.json config.json
  echo "[4/4] Creé config.json: ábrelo, pega la llave en syncKey y llena branch, smartmenuUrl y smartmenuKey."
fi
chmod +x ./*.sh
echo "Listo."
