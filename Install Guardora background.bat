@echo off
rem Sets up Guardora on this computer and runs it in the background:
rem starts at sign-in, no window, restarts if it stops. Double-click once; that is all.
rem It collects CVs while this computer is on, and catches up on everything it missed while it was off.
title Guardora setup
cd /d "%~dp0"

rem 1. Node.js 22 or newer (installs it if missing)
set "PATH=%PATH%;%ProgramFiles%\nodejs"
node -e "process.exit(+process.versions.node.split('.')[0] >= 22 ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or newer is needed. Installing it now...
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
  node -e "process.exit(+process.versions.node.split('.')[0] >= 22 ? 0 : 1)" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo Please install Node.js LTS from https://nodejs.org , then double-click this file again.
    start "" https://nodejs.org/en/download
    pause
    exit /b 1
  )
)

rem 2. Guardora's packages (first time only; needs internet)
if not exist node_modules (
  echo Installing Guardora...
  call npm install --omit=dev
  if errorlevel 1 (
    echo Installing failed. Check the internet connection and try again.
    pause
    exit /b 1
  )
)

rem 3. Start at every sign-in, hidden
schtasks /Create /F /TN "Guardora" /SC ONLOGON /RL LIMITED /TR "wscript.exe \"%~dp0tools\windows\start-hidden.vbs\"" >nul
if errorlevel 1 (
  echo Could not create the start-at-sign-in task. Guardora will run now, but start it with "Start Guardora.bat" after a restart.
)

rem 4. Start now and open it
wscript.exe "%~dp0tools\windows\start-hidden.vbs"
echo.
echo Guardora is running in the background and starts by itself when you sign in to Windows.
echo Opening http://localhost:8787 ...
ping -n 9 127.0.0.1 >nul
start "" http://localhost:8787
echo.
echo IMPORTANT: copy the file data\master.key to a USB stick or password manager. Without it the CVs cannot be opened.
pause
