@echo off
rem Double-click to remove Visual Git for the current user.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall
echo.
pause
