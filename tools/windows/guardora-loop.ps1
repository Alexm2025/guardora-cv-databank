# Keeps Guardora running in the background on this Windows computer: restarts it if it stops,
# and writes its output to data\guardora.log. Started hidden at sign-in by the "Guardora" scheduled task.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
New-Item -ItemType Directory -Force -Path (Join-Path $root 'data') | Out-Null
$log = Join-Path $root 'data\guardora.log'
$port = if ($env:PORT) { $env:PORT } else { '8787' }

while ($true) {
  # Already running (for example started twice): just check again later.
  try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$port/healthz" | Out-Null
    Start-Sleep -Seconds 60
    continue
  } catch { }
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Move-Item -Force $log "$log.old" }
  Add-Content -Encoding UTF8 -Path $log -Value ("`r`n=== Starting Guardora " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + " ===")
  cmd.exe /c "node server\index.js >> `"$log`" 2>&1"
  Add-Content -Encoding UTF8 -Path $log -Value ("=== Guardora stopped " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "; restarting in 10 s ===")
  Start-Sleep -Seconds 10
}
