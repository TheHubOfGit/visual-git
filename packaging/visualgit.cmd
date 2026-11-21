@echo off
rem Visual Git launcher for Windows. Works from any folder, no installation needed.
rem Uses the private copies of Node and Git under runtime\ when the installer
rem put them there, and whatever is already on PATH otherwise.
setlocal
set "VG_HOME=%~dp0"
set "VG_NODE=node"
if exist "%VG_HOME%runtime\node\node.exe" set "VG_NODE=%VG_HOME%runtime\node\node.exe"
if exist "%VG_HOME%runtime\git\cmd\git.exe" set "PATH=%VG_HOME%runtime\git\cmd;%PATH%"

if "%VG_NODE%"=="node" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Visual Git needs Node.js and could not find it.
    echo Double-click install.cmd in "%VG_HOME%" and it will set one up for you. No admin rights needed.
    pause
    exit /b 1
  )
)

"%VG_NODE%" "%VG_HOME%app\build\cli.mjs" %*
set "VG_EXIT=%ERRORLEVEL%"
if not "%VG_EXIT%"=="0" if "%VG_PAUSE_ON_ERROR%"=="1" pause
exit /b %VG_EXIT%
