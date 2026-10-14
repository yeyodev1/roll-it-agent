@echo off
cd /d "%~dp0"
title Roll It - Quitar arranque automatico
schtasks /Delete /TN "RollIt Agente" /F >nul 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\RollIt-Agente.vbs" >nul 2>nul
if not exist datos mkdir datos
echo detener> datos\detener
if exist datos\agente.lock for /f %%p in (datos\agente.lock) do taskkill /PID %%p /F >nul 2>nul
echo Listo: el agente se detuvo y ya no arranca solo.
pause
