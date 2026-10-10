@echo off
setlocal EnableDelayedExpansion

:: ============================================================
::  ConceptLens - One-Click Launcher for Windows
::  Offline Course Notes Concept Extractor & Study Assistant
:: ============================================================

title ConceptLens Launcher
cd /d "%~dp0"

echo ============================================================
echo                    ConceptLens - Local Demo
echo    Offline Course Notes Concept Extractor ^& Study Assistant
echo ============================================================
echo.

:: ------------------------------------------------------------
:: 1. Check Node.js and npm
:: ------------------------------------------------------------
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js and npm were not found in your PATH.
    echo Please download and install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: ------------------------------------------------------------
:: 2. Resolve Python Virtual Environment
:: ------------------------------------------------------------
set "VENV_PYTHON="

if exist "%~dp0.venv\Scripts\python.exe" (
    set "VENV_PYTHON=%~dp0.venv\Scripts\python.exe"
) else if exist "%~dp0backend\.venv\Scripts\python.exe" (
    set "VENV_PYTHON=%~dp0backend\.venv\Scripts\python.exe"
)

if not defined VENV_PYTHON (
    echo [*] No existing virtual environment found. Setting up .venv...
    
    where python >nul 2>&1
    if %errorlevel% equ 0 (
        set "SYS_PYTHON=python"
    ) else (
        where py >nul 2>&1
        if %errorlevel% equ 0 (
            set "SYS_PYTHON=py"
        ) else (
            echo [ERROR] Python 3.11+ was not found in your PATH.
            echo Please download and install Python from https://www.python.org/
            echo.
            pause
            exit /b 1
        )
    )

    echo [*] Creating Python virtual environment in .venv...
    "%SYS_PYTHON%" -m venv "%~dp0.venv"
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    set "VENV_PYTHON=%~dp0.venv\Scripts\python.exe"
)

:: ------------------------------------------------------------
:: 3. Configure backend environment file (.env)
:: ------------------------------------------------------------
if not exist "%~dp0backend\.env" (
    if exist "%~dp0backend\.env.example" (
        echo [*] Initializing backend\.env from template...
        copy /y "%~dp0backend\.env.example" "%~dp0backend\.env" >nul
    )
)

:: ------------------------------------------------------------
:: 4. Check & Install Backend Dependencies
:: ------------------------------------------------------------
"%VENV_PYTHON%" -c "import fastapi, uvicorn, spacy" >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Installing backend Python packages from requirements.txt...
    "%VENV_PYTHON%" -m pip install -r "%~dp0backend\requirements.txt"
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install backend requirements.
        pause
        exit /b 1
    )
)

:: Check spaCy English language model
"%VENV_PYTHON%" -c "import spacy; spacy.load('en_core_web_sm')" >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Downloading spaCy English model: en_core_web_sm...
    "%VENV_PYTHON%" -m spacy download en_core_web_sm
)

:: ------------------------------------------------------------
:: 5. Check & Install Frontend Dependencies
:: ------------------------------------------------------------
if not exist "%~dp0frontend\node_modules" (
    echo [*] Installing frontend packages: npm install...
    pushd "%~dp0frontend"
    call npm install
    popd
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install frontend packages.
        pause
        exit /b 1
    )
)

echo [OK] All dependencies and configurations verified.
echo.

:: ------------------------------------------------------------
:: 6. Launch Backend Service (Host 0.0.0.0 Port 8000 for Mobile Access)
:: ------------------------------------------------------------
echo [1/3] Starting backend service on 0.0.0.0:8000 (accessible on local network)...
pushd "%~dp0backend"
start "ConceptLens Backend - Port 8000" cmd /k "title ConceptLens Backend - Port 8000 && cd /d "%~dp0backend" && "%VENV_PYTHON%" -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"
popd

:: ------------------------------------------------------------
:: 7. Launch Frontend Dev Server (Host 0.0.0.0 Port 5173 for Mobile Access)
:: ------------------------------------------------------------
echo [2/3] Starting frontend dev server on 0.0.0.0:5173 (accessible on local network)...
pushd "%~dp0frontend"
start "ConceptLens Frontend - Port 5173" cmd /k "title ConceptLens Frontend - Port 5173 && cd /d "%~dp0frontend" && npm run dev -- --host 0.0.0.0"
popd

:: ------------------------------------------------------------
:: 8. Open Web Browser
:: ------------------------------------------------------------
echo [3/3] Opening ConceptLens in your default browser...
timeout /t 3 /nobreak >nul 2>&1
start http://localhost:5173

echo.
echo ============================================================
echo   ConceptLens is now running!
echo.
echo   Local Desktop:
echo     Frontend (Web UI):   http://localhost:5173
echo     Backend (API Docs):  http://localhost:8000/docs
echo.
echo   Mobile Phone Testing (Over same Wi-Fi network):
echo     Find your PC's IP address (run 'ipconfig' in command prompt)
echo     Then open on your phone:  http://YOUR_PC_IP:5173
echo.
echo   To stop the application, close the backend and frontend
echo   terminal windows.
echo ============================================================
echo.
pause
