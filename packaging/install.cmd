@echo off
rem Double-click to install Visual Git for the current user. No admin rights needed.
rem This wrapper only exists so the PowerShell installer runs even where
rem scripts are blocked by default; it changes no system policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
