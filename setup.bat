@echo off
cd /d "%~dp0"
echo [1/2] Python venv + dependencies
if not exist backend\.venv python -m venv backend\.venv
backend\.venv\Scripts\python -m pip install -r backend\requirements.txt || exit /b 1
echo [2/2] Electron
call npm install || exit /b 1
echo Done. Run: npm start
