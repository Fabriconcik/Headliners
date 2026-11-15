@echo off
chcp 65001 >nul
title Live News Chaos (Головорезы) - Запуск игры
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ================================================================
echo    LIVE NEWS CHAOS (ГОЛОВОРЕЗЫ) — ЗАПУСК В 1 КЛИК
echo ================================================================
echo.

:: 1. Проверяем наличие Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ОШИБКА] Node.js не найден в вашей системе!
    echo.
    echo Для работы сервера нужен Node.js.
    echo Скачайте и установите его с официального сайта:
    echo https://nodejs.org (рекомендуется версия LTS)
    echo.
    echo Открываем страницу загрузки Node.js в браузере...
    start https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 2. Проверяем наличие node_modules
if not exist "node_modules\" (
    echo [1/2] Библиотеки не найдены. Установка зависимостей (npm install)...
    echo Пожалуйста, подождите 15-30 секунд...
    call npm.cmd install
    if !errorlevel! neq 0 (
        echo.
        echo [ОШИБКА] Не удалось установить зависимости через npm.cmd!
        pause
        exit /b 1
    )
    echo [OK] Зависимости успешно установлены.
    echo.
)

:: 3. Проверяем сборку (dist/server и dist/client)
set NEED_BUILD=0
if not exist "dist\server\index.js" set NEED_BUILD=1
if not exist "dist\client\index.html" set NEED_BUILD=1

if "!NEED_BUILD!"=="1" (
    echo [2/2] Компиляция проекта (Vite клиент + TypeScript сервер)...
    echo Пожалуйста, подождите...
    call npm.cmd run build
    if !errorlevel! neq 0 (
        echo.
        echo [ОШИБКА] Сборка проекта завершилась с ошибкой!
        pause
        exit /b 1
    )
    echo [OK] Проект успешно собран.
    echo.
)

:: 4. Запускаем сервер напрямую через node.exe (без PowerShell и без ограничений ExecutionPolicy!)
:: Флаг OPEN_BROWSER=1 даёт сигнал серверу открыть окно браузера сразу после старта HTTP-порта.
set OPEN_BROWSER=1
echo [Запуск] Сервер стартует... Браузер откроется автоматически!
echo.
node dist\server\index.js

if %errorlevel% neq 0 (
    echo.
    echo [Внимание] Сервер остановился с кодом ошибки %errorlevel%.
    pause
)
