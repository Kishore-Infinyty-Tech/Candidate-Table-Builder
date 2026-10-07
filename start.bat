@echo off
REM Candidate Table Builder - one-click start for Windows.
REM Installs what is missing (Python, Node.js, packages), asks for the Gemini
REM key on first run, then starts the app at http://localhost:8000
setlocal EnableExtensions EnableDelayedExpansion
title Candidate Table Builder
cd /d "%~dp0"

echo.
echo  ==========================================
echo    Candidate Table Builder
echo  ==========================================
echo.

REM ---------------------------------------------------------------- 1. Python
call :find_python
if not defined PY (
  echo  Python was not found on this computer. Installing it now - this can take a few minutes...
  call :winget_install Python.Python.3.12 "/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1"
  call :refresh_path
  call :find_python
)
if not defined PY goto :no_python
echo  [OK] Python

REM ---------------------------------------------------------------- 2. Python packages
REM A .venv copied from another computer does not work here, so test it and rebuild if needed.
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import fastapi, uvicorn, openpyxl, rapidfuzz, httpx" >nul 2>&1
  if errorlevel 1 (
    echo  Repairing the Python environment...
    rmdir /s /q ".venv"
  )
)
if not exist ".venv\Scripts\python.exe" (
  echo  Installing Python packages - first run only, needs internet...
  !PY! -m venv .venv
  if errorlevel 1 goto :error
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r api\requirements.txt "uvicorn[standard]"
  if errorlevel 1 goto :error
)
echo  [OK] Python packages

REM ---------------------------------------------------------------- 3. Dashboard
if not exist "frontend\dist\index.html" (
  call :find_node
  if not defined NODE_OK (
    echo  Node.js was not found. Installing it now - Windows may ask for permission, click Yes...
    call :winget_install OpenJS.NodeJS.LTS ""
    call :refresh_path
    call :find_node
  )
  if not defined NODE_OK goto :no_node
  echo  Building the dashboard - first run only, takes a minute or two...
  pushd frontend
  call npm install --no-audit --no-fund --loglevel=error
  if errorlevel 1 (
    popd
    goto :error
  )
  call npm run build
  if errorlevel 1 (
    popd
    goto :error
  )
  popd
)
echo  [OK] Dashboard

REM ---------------------------------------------------------------- 4. Gemini API key
if not exist ".env" (
  echo.
  echo  A Gemini API key is needed. Get one free at: https://aistudio.google.com/apikey
  set "KEY="
  set /p "KEY=  Paste your Gemini API key here and press Enter: "
  if not defined KEY (
    echo  No key entered.
    goto :error
  )
  > ".env" echo GEMINI_API_KEY=!KEY!
  >> ".env" echo GEMINI_MODEL=gemini-3.8-flash
  echo  Saved the key in .env - edit that file later to change it.
)
echo  [OK] Gemini API key

REM ---------------------------------------------------------------- 5. Already running?
netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo  The app already seems to be running. Opening it in the browser...
  start "" http://localhost:8000
  timeout /t 5 >nul
  goto :end
)

REM ---------------------------------------------------------------- 6. Start
echo.
echo  Candidate Table Builder is running at http://localhost:8000
echo  Keep this window open while you use it. Close it to stop the app.
echo.
start "" cmd /c "timeout /t 3 >nul & start "" http://localhost:8000"
".venv\Scripts\python.exe" -m uvicorn api.index:app --host 127.0.0.1 --port 8000
goto :end


REM ================================================================ helpers

:find_python
REM Sets PY to a working Python 3.10+ command. The Microsoft Store "python"
REM placeholder fails this test, so it is never picked by mistake.
set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if not errorlevel 1 (
  set "PY=py -3"
  exit /b 0
)
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if not errorlevel 1 (
  set "PY=python"
  exit /b 0
)
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
  if exist "%%D\python.exe" set "PY="%%D\python.exe""
)
exit /b 0

:find_node
set "NODE_OK="
node -e "process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)" >nul 2>&1
if not errorlevel 1 set "NODE_OK=1"
exit /b 0

:winget_install
REM %1 = package id, %2 = installer override (or "")
where winget >nul 2>&1
if errorlevel 1 (
  echo  Automatic install is not available on this computer.
  exit /b 1
)
if "%~2"=="" (
  winget install --id %1 -e --silent --accept-package-agreements --accept-source-agreements
) else (
  winget install --id %1 -e --silent --accept-package-agreements --accept-source-agreements --override "%~2"
)
exit /b 0

:refresh_path
REM Pick up PATH changes made by the installers without restarting Windows.
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0

:no_python
echo.
echo  Python could not be installed automatically.
echo  1. Download it from https://www.python.org/downloads/
echo  2. In the installer, TICK "Add python.exe to PATH", then Install.
echo  3. Run start.bat again.
goto :error

:no_node
echo.
echo  Node.js could not be installed automatically.
echo  1. Download the LTS version from https://nodejs.org/
echo  2. Install it with the default options.
echo  3. Run start.bat again.
goto :error

:error
echo.
echo  Setup did not finish - see the messages above.
echo  Check the internet connection and run start.bat again.
pause
exit /b 1

:end
endlocal
