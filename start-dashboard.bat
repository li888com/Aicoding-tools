@echo off
cd /d "%~dp0"
echo Starting MCP Toolbox Dashboard...
echo.
echo Dashboard: http://127.0.0.1:3000
echo Username: admin
echo Password: change-me
echo.
echo Press Ctrl+C to stop the server.
echo.
node dist/dashboard-server.js
pause
