@echo off
cd /d "%~dp0"
title Roll It - Arranque automatico
set TASK=RollIt Agente
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\RollIt-Agente.vbs

schtasks /Create /TN "%TASK%" /TR "wscript.exe \"%~dp0iniciar-oculto.vbs\"" /SC ONLOGON /RL LIMITED /F >nul 2>nul
if errorlevel 1 goto inicio
echo Tarea programada creada: el agente arranca solo al iniciar sesion.
goto arrancar

:inicio
rem Sin permisos de administrador schtasks no deja usar ONLOGON: se usa la carpeta Inicio.
(
  echo Set shell = CreateObject^("WScript.Shell"^)
  echo shell.CurrentDirectory = "%~dp0"
  echo shell.Run "cmd /c ""%~dp0iniciar.bat""", 0, False
) > "%STARTUP%"
echo Agregado a la carpeta Inicio: el agente arranca solo al iniciar sesion.

:arrancar
wscript.exe "%~dp0iniciar-oculto.vbs"
echo El agente ya esta corriendo en segundo plano. Sus registros estan en la carpeta logs.
pause
