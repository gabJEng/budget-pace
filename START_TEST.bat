@echo off
cd /d "%~dp0"
echo.
echo Starting Budget Pace TEST instance...
echo Open this address in your browser:
echo.
echo     http://127.0.0.1:8001
echo.
echo Press Ctrl+C in this window to stop the server.
echo.
python -m http.server 8001 --bind 127.0.0.1
pause
