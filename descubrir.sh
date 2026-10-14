#!/usr/bin/env bash
cd "$(dirname "$0")"
node dist/index.js descubrir
echo "Envía a Bakano el archivo descubrimiento-....zip que quedó en el Escritorio."
