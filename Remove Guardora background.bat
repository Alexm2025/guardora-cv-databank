@echo off
rem Stops Guardora and removes the start-at-sign-in task. Your data in the data folder is kept.
schtasks /Delete /F /TN "Guardora" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -match 'guardora-loop\.ps1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; $f = Join-Path '%~dp0' 'data\guardora.pid'; if (Test-Path $f) { $id = [int](Get-Content $f); $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $id -Force }; Remove-Item $f -Force }"
echo Guardora background task removed. Your data is kept in the data folder.
pause
