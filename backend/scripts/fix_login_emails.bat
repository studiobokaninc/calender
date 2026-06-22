@echo off
REM fix_login_emails.bat  --  cmd_553/554 Calendarログイン是正 DB ラッパー
REM
REM 使い方:
REM   fix_login_emails.bat                              -- dry-run (診断のみ)
REM   fix_login_emails.bat --apply                      -- 正規化適用
REM   fix_login_emails.bat --apply --set-uid28-email ryoji@studiobokan.com
REM   fix_login_emails.bat --apply --yes               -- 確認プロンプトなし
REM   fix_login_emails.bat --db "E:\calender\backend\app\project_management.db"

chcp 65001 > nul

REM このバッチファイルが置かれている backend\scripts\ から venv を参照
set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%.."
set "PYTHON=%BACKEND_DIR%\venv\Scripts\python.exe"
set "SCRIPT=%SCRIPT_DIR%fix_login_emails.py"

if not exist "%PYTHON%" (
    echo [ERROR] Python venv が見つかりません: %PYTHON%
    echo   E:\calender\backend\venv\Scripts\python.exe を確認してください。
    pause
    exit /b 1
)

if not exist "%SCRIPT%" (
    echo [ERROR] スクリプトが見つかりません: %SCRIPT%
    pause
    exit /b 1
)

echo [INFO] Python: %PYTHON%
echo [INFO] Script: %SCRIPT%
echo.

"%PYTHON%" "%SCRIPT%" %*

echo.
pause
