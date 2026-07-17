@echo off
setlocal

set "ROOT=%~dp0"
set "SCRIPT=%ROOT%scripts\ops\switch-supabase-route.ps1"

if not exist "%SCRIPT%" (
  echo.
  echo ERROR: scripts\ops\switch-supabase-route.ps1 was not found.
  echo Keep this launcher and the PowerShell script in the Mathin project root.
  echo.
  pause
  exit /b 1
)

:menu
cls
echo =================================================
echo        Mathin Supabase Route Switcher
echo =================================================
echo.
echo  [1] LAN direct       - normal local development
echo  [2] Public Internet  - test the full production route
echo  [3] Show status
echo  [Q] Quit
echo.
choice /C 123Q /N /M "Choose"

if errorlevel 4 goto :end
if errorlevel 3 goto :status
if errorlevel 2 goto :public
if errorlevel 1 goto :lan

:lan
call :runElevated Lan
goto :end

:public
call :runElevated Public
goto :end

:status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Mode Status
goto :end

:runElevated
echo.
echo Windows will ask for administrator permission to update hosts.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '%SCRIPT%', '-Mode', '%~1'); exit $p.ExitCode"
exit /b %errorlevel%

:end
echo.
pause
exit /b
