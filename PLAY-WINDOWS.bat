@echo off
title Craftverse
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

set CRAFTVERSE_OPEN=1
echo.
echo   Starting Craftverse...
echo   Keep this window open while you play. Closing it stops the game.
echo.
node serve.js
goto end

:nonode
echo.
echo   Craftverse needs Node.js to run (it is free and takes a minute).
echo.
echo     1. Go to  https://nodejs.org
echo     2. Download the "LTS" version and install it.
echo     3. Double-click this file again.
echo.

:end
pause
