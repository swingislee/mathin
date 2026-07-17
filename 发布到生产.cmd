@echo off
setlocal

set "ROOT=%~dp0"
set "SCRIPT=%ROOT%scripts\ops\publish-mathin-xiaomi.ps1"

if not exist "%SCRIPT%" (
  echo.
  echo ERROR: scripts\ops\publish-mathin-xiaomi.ps1 was not found.
  echo Keep this launcher in the Mathin project root.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
