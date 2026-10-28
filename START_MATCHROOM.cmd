@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
echo Match for Every Fan - Demo V5 - http://127.0.0.1:3008
echo Open the address above in a browser. Keep this window open.
node server.js
pause
