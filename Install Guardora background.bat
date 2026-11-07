@echo off
rem Runs Guardora in the background on this computer: starts at sign-in, no window, restarts if it stops.
rem It keeps collecting CVs while this computer is on, and catches up on everything it missed when it was off.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing for the first time...
  call npm install --omit=dev
)
schtasks /Create /F /TN "Guardora" /SC ONLOGON /RL LIMITED /TR "wscript.exe \"%~dp0tools\windows\start-hidden.vbs\"" >nul
if errorlevel 1 (
  echo Could not create the scheduled task.
  pause
  exit /b 1
)
wscript.exe "%~dp0tools\windows\start-hidden.vbs"
echo Guardora now runs in the background and starts by itself when you sign in to Windows.
echo Opening http://localhost:8787 ...
ping -n 7 127.0.0.1 >nul
start "" http://localhost:8787
