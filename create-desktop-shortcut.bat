@echo off
chcp 65001 >nul
title Создание ярлыка игры на Рабочем столе
cd /d "%~dp0"

echo Создание ярлыка Live News Chaos на Рабочем столе...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desktop = [System.Environment]::GetFolderPath('Desktop'); if (-not $desktop) { $desktop = [System.IO.Path]::Combine($env:USERPROFILE, 'Desktop') }; try { $s = $ws.CreateShortcut((Join-Path $desktop 'Live News Chaos.lnk')); $s.TargetPath = (Join-Path '%~dp0' 'start.bat'); $s.WorkingDirectory = '%~dp0'; $s.Description = 'Live News Chaos (Головорезы) - Запуск игры в 1 клик'; $s.Save(); exit 0 } catch { exit 1 }"

if %errorlevel% equ 0 (
    echo.
    echo [УСПЕХ] Ярлык "Live News Chaos" создан на вашем Рабочем столе!
    echo Теперь вы можете запускать игру прямо с Рабочего стола в 1 клик.
) else (
    echo.
    echo [ИНФОРМАЦИЯ] Не удалось автоматически записать ярлык на Рабочий стол.
    echo Вы можете просто кликнуть правой кнопкой мыши по start.bat:
    echo   -> Отправить -> Рабочий стол (создать ярлык)
)

echo.
pause
