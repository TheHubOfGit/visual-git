@echo off
rem Double-click to open Visual Git. Keeps the window open if something goes wrong
rem so the message can be read.
set "VG_PAUSE_ON_ERROR=1"
call "%~dp0visualgit.cmd" %*
