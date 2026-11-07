@echo off
rem Uploads Guardora to your GitHub account as a PRIVATE repository (Alexm2025/guardora).
rem Your data, CVs and the master key are never uploaded (see .gitignore).
cd /d "%~dp0"
git remote get-url origin >/dev/null 2>&1
if errorlevel 1 (
  gh repo create Alexm2025/guardora --private --description "Guardora - The Guardians CV Databank" --source . --remote origin --push
) else (
  git push -u origin main
)
pause
