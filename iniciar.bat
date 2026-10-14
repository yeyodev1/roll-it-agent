@echo off
cd /d "%~dp0"
title Roll It - Agente (no cierres esta ventana)
if exist datos\detener del datos\detener

:loop
node dist\index.js %*
rem 3 = ya hay otra copia corriendo: no se insiste.
if %errorlevel%==3 exit /b 0
if exist datos\detener exit /b 0
echo El agente se detuvo. Se reinicia en 30 segundos...
timeout /t 30 /nobreak >nul
goto loop
