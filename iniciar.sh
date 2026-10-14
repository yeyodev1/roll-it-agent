#!/usr/bin/env bash
# Corre el agente y lo reinicia si se detiene. Pasa los argumentos al agente (p. ej. ./iniciar.sh auto).
cd "$(dirname "$0")"
rm -f datos/detener
while true; do
  node dist/index.js "$@"
  code=$?
  # 3 = ya hay otra copia corriendo: no se insiste.
  [ "$code" -eq 3 ] && exit 0
  [ -f datos/detener ] && exit 0
  echo "El agente se detuvo (código $code). Se reinicia en 30 segundos..."
  sleep 30
done
