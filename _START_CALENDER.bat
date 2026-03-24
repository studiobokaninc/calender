@echo off
REM バックエンドを新しいコマンドプロンプトで起動
start "Backend Server" cmd /k "cd /d E:\calender\backend && call venv\Scripts\activate.bat && .\venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-dir app --reload-dir alembic --host 0.0.0.0 --port 8001"

REM 少し待機（バックエンドが立ち上がるのを待つために必要なら調整）
timeout /t 5 > nul

REM フロントエンドを新しいコマンドプロンプトで起動
start "Frontend Server" cmd /k "cd /d E:\calender\frontend && npm run dev"