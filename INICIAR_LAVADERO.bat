@echo off
title Lavadero App
echo.
echo  ========================================
echo   Iniciando Lavadero App...
echo  ========================================
echo.
cd /d "%~dp0"
start http://localhost:3000
node server.js
pause
