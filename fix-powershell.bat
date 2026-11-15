@echo off
chcp 65001 >nul
title Настройка PowerShell - Разрешение запуска скриптов npm
cd /d "%~dp0"

echo ================================================================
echo    ИСПРАВЛЕНИЕ ОШИБКИ ВЫПОЛНЕНИЯ СЦЕНАРИЕВ POWERSHELL
echo ================================================================
echo.
echo Ошибка: "выполнение сценариев отключено в этой системе [PSSecurityException]"
echo.
echo 1. Пытаемся включить RemoteSigned для текущего пользователя Windows...

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force; Write-Output 'SUCCESS' } catch { Write-Output 'NEED_ELEVATION' }" > "%TEMP%\ps_policy_res.txt" 2>nul

findstr /i "SUCCESS" "%TEMP%\ps_policy_res.txt" >nul 2>nul
if %errorlevel% equ 0 goto success

echo.
echo [Информация] Требуется подтверждение прав администратора.
echo Запрашиваем окно подтверждения Windows UAC...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -Command Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force' -Wait" 2>nul

powershell -NoProfile -Command "Get-ExecutionPolicy" > "%TEMP%\ps_policy_chk.txt" 2>nul
findstr /i "RemoteSigned Unrestricted" "%TEMP%\ps_policy_chk.txt" >nul 2>nul
if %errorlevel% equ 0 goto success

echo.
echo [ИНФОРМАЦИЯ] Системная политика осталась без изменений.
echo Вы можете играть БЕЗ изменения политики любым удобным способом:
echo   1. Просто дважды кликайте на start.bat (запуск в 1 клик без PowerShell).
echo   2. Или в VS Code нажмите Ctrl + Shift + B.
echo   3. Или в терминале вместо 'npm start' пишите: npm.cmd start
goto finish

:success
echo.
echo [УСПЕХ] Политика выполнения PowerShell успешно обновлена на RemoteSigned!
echo Теперь команды npm start, npm run dev, npm test работают в терминале без ошибок.

:finish
if exist "%TEMP%\ps_policy_res.txt" del "%TEMP%\ps_policy_res.txt" 2>nul
if exist "%TEMP%\ps_policy_chk.txt" del "%TEMP%\ps_policy_chk.txt" 2>nul
echo.
echo ================================================================
pause
