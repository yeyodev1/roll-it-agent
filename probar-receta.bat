@echo off
cd /d "%~dp0"
title Roll It - Probar receta de SmartMenu
rem Corre la receta una vez con el navegador visible y no sube nada.
node dist\index.js probar-receta %*
pause
