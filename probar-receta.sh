#!/usr/bin/env bash
# Corre la receta una vez con el navegador visible y no sube nada (--subir para subir, --oculto sin ventana).
cd "$(dirname "$0")"
node dist/index.js probar-receta "$@"
