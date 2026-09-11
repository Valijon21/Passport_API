@echo off
chcp 65001 >nul
title O'zbekiston Hujjat OCR — Frontend

echo ===================================================
echo   O'zbekiston Hujjat OCR — Frontend UI
echo ===================================================
echo.

cd /d "%~dp0frontend"

echo [INFO] Frontend brauzerda ochilmoqda...
start "" index.html
