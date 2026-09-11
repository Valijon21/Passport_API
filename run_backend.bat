@echo off
chcp 65001 >nul
title O'zbekiston Hujjat OCR — Backend Server

echo ===================================================
echo   O'zbekiston Hujjat OCR — Backend Server
echo ===================================================
echo.

cd /d "%~dp0backend"

:: 1. Check virtualenv
if not exist "venv\Scripts\activate.bat" (
    echo [INFO] Virtual muhit (venv) topilmadi. Yaratilmoqda...
    py -3 -m venv venv 2>nul || python -m venv venv 2>nul || python3 -m venv venv 2>nul
    if not exist "venv\Scripts\activate.bat" (
        echo [XATO] Python topilmadi! Iltimos, Python 3.10+ o'rnating va PATH ga qo'shing.
        pause
        exit /b 1
    )
    echo [INFO] Kerakli kutubxonalar o'rnatilmoqda...
    call venv\Scripts\activate.bat
    python -m pip install --upgrade pip
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate.bat
)

:: 2. Ensure logs folder
if not exist "logs" mkdir logs

:: 3. Database migrations
echo.
echo [INFO] Ma'lumotlar bazasi tekshirilmoqda...
python manage.py migrate --run-syncdb

:: 4. Start Server
echo.
echo ===================================================
echo   Server ishga tushmoqda: http://127.0.0.1:8000/
echo   API holati: http://127.0.0.1:8000/api/v1/health/
echo   Frontendni ochish uchun 'run_frontend.bat' ni bosing
echo ===================================================
echo.

python manage.py runserver 127.0.0.1:8000

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [XATO] Server to'xtadi yoki xatolik yuz berdi.
    pause
)
