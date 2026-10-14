@echo off
cd /d "%~dp0"
title Roll It - Descubrir SmartMenu
node dist\index.js descubrir
echo.
echo Envia a Bakano el archivo descubrimiento-....zip que quedo en el Escritorio.
pause
