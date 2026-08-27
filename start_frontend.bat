@echo off
echo Starting Vestida frontend (local dev)...

if not exist "%~dp0frontend\node_modules" (
    echo Dependencies not found. Running npm install...
    call npm install --prefix "%~dp0frontend"
    if %errorlevel% neq 0 (
        echo npm install failed! Exiting.
        pause
        exit /b %errorlevel%
    )
)

start "Vestida Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo Frontend launched. Vite dev server will be at http://localhost:5173
echo If the port is already in use, Vite prints the actual URL in the new window.
pause
