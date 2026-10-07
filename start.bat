@echo off
REM Start the Candidate Table Builder locally and open it in the browser.
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Setting up Python environment - first run only...
  python -m venv .venv || goto :error
  ".venv\Scripts\python.exe" -m pip install -r api\requirements.txt "uvicorn[standard]" || goto :error
)

if not exist "frontend\dist\index.html" (
  echo Building the dashboard - first run only...
  pushd frontend
  call npm install || goto :error
  call npm run build || goto :error
  popd
)

if not exist ".env" (
  echo.
  echo Missing .env file. Copy .env.example to .env and put your Gemini API key in it.
  goto :error
)

echo.
echo Candidate Table Builder is running at http://localhost:8000
echo Keep this window open. Press Ctrl+C to stop.
start "" http://localhost:8000
".venv\Scripts\python.exe" -m uvicorn api.index:app --host 127.0.0.1 --port 8000
goto :eof

:error
echo.
echo Setup failed - see the messages above.
pause
