# Creates "Guardora" shortcuts (Desktop and Start menu) that open Guardora in its own window, like a normal program:
# no address bar and no need to type localhost. Uses Chrome if installed, otherwise Microsoft Edge.
# Run by "Install Guardora background.bat". Optional: -Destinations "C:\some\folder" (used for testing).
param([string[]]$Destinations)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$port = '8787'
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  $m = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
  if ($m) { $port = $m.Matches[0].Groups[1].Value }
}
$url = "http://localhost:$port"

$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $Destinations) {
  $Destinations = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
}

$shell = New-Object -ComObject WScript.Shell
foreach ($dir in $Destinations) {
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $link = $shell.CreateShortcut((Join-Path $dir 'Guardora.lnk'))
  if ($browser) {
    $link.TargetPath = $browser
    $link.Arguments = "--app=$url"
  } else {
    $link.TargetPath = "$env:WINDIR\explorer.exe"
    $link.Arguments = $url
  }
  $link.IconLocation = (Join-Path $root 'public\icons\guardora.ico') + ',0'
  $link.Description = 'Guardora - The Guardians CV Databank'
  $link.WorkingDirectory = $root
  $link.Save()
  Write-Output ("Shortcut: " + (Join-Path $dir 'Guardora.lnk'))
}
