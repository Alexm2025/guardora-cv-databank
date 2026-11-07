@echo off
title Guardora
cd /d "%~dp0"
if not exist node_modules (
  echo Installing for the first time...
  call npm install --omit=dev
)
echo.
echo Guardora is starting. Open http://localhost:8787 in your browser.
echo Keep this window open while you use it on this computer.
echo.
node server/index.js
pause
