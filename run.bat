@echo off
title VPS Fee Tracker
echo ========================================================
echo   Launching VPS Fee Record Tracker...
echo ========================================================
npm start
start http://localhost:3000
echo.
echo Opening browser to http://localhost:3000
timeout /t 2 /nobreak >nul
pause
