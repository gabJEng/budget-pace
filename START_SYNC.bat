@echo off
cd /d "%~dp0"
echo.
echo Starting Budget Pace v1.0 with OneDrive sync support...
echo.
echo IMPORTANT: Open this exact address for Microsoft sign-in:
echo.
echo     http://localhost:8001/
echo.
echo Do not use 127.0.0.1 for the OneDrive sign-in setup.
echo Press Ctrl+C in this window to stop the server.
echo.
python -m http.server 8001 --bind 127.0.0.1
pause
