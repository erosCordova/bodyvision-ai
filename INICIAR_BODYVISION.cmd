@echo off
setlocal
cd /d "%~dp0"
title BODYVISION AI - Inicio local

where docker >nul 2>&1
if errorlevel 1 (
  echo ERROR: Docker no esta disponible. Instala o inicia Docker Desktop.
  goto :failed
)

call docker info --format "{{.OSType}}" 2>nul | findstr /x /c:"linux" >nul
if errorlevel 1 (
  echo ERROR: Inicia Docker Desktop y usa contenedores Linux.
  goto :failed
)

if not exist ".env" (
  echo ERROR: Falta .env. Realiza primero la instalacion inicial documentada en README.md.
  goto :failed
)

call docker compose up --wait --wait-timeout 600
if errorlevel 1 (
  echo ERROR: Los servicios no iniciaron correctamente.
  echo Revisa el estado con: docker compose ps
  goto :failed
)

where python >nul 2>&1
if errorlevel 1 (
  echo AVISO: Python no esta disponible para validar el arranque.
  echo Los servicios estan iniciados, pero no se ha comprobado su funcionamiento.
  goto :failed
)

call python scripts\check_local_installation.py
if errorlevel 1 (
  echo ERROR: La comprobacion del entorno local no fue satisfactoria.
  goto :failed
)

echo.
echo BODYVISION AI iniciado y comprobado.
echo Abriendo http://localhost:8080
start "" "http://localhost:8080"
exit /b 0

:failed
echo.
echo No se han eliminado ni reiniciado los datos de PostgreSQL.
pause
exit /b 1
