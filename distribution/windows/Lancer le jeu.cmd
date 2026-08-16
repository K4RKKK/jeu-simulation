@echo off
setlocal
title Civilisation emergente
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if errorlevel 1 (
  echo.
  echo Le jeu n'a pas pu demarrer. Consultez le fichier logs\server.log.
  pause
)
