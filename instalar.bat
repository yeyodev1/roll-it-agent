@echo off
cd /d "%~dp0"
title Roll It - Instalar agente

where node >nul 2>nul
if errorlevel 1 goto sin_node
for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 goto sin_node

echo [1/4] Instalando dependencias (tarda unos minutos)...
call npm install --no-audit --no-fund
if errorlevel 1 goto error

echo [2/4] Descargando el navegador Chromium...
call npx playwright install chromium
if errorlevel 1 goto error

echo [3/4] Preparando el agente...
call npm run build
if errorlevel 1 goto error

if exist config.json (
  echo [4/4] config.json ya existe, no lo toco.
) else (
  copy config.example.json config.json >nul
  echo [4/4] Se abre config.json: pega la llave en syncKey y llena branch, smartmenuUrl y smartmenuKey. Guarda y cierra.
  notepad config.json
)
echo.
echo Listo. Ahora abre descubrir.bat o instalar-servicio.bat segun te indiquen.
pause
exit /b 0

:sin_node
echo Falta Node.js (version 20 o mas nueva).
echo Se abre la pagina de descarga: baja la version LTS e instalala con todo por defecto.
echo Cuando termine, cierra esta ventana y vuelve a abrir instalar.bat
start https://nodejs.org/es/download
pause
exit /b 1

:error
echo.
echo Algo fallo. Toma una foto de esta ventana y enviala a Bakano.
pause
exit /b 1
