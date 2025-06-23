@echo off
chcp 65001 > nul
REM カレンダーアプリ起動スクリプト（Anaconda環境版）

echo カレンダーアプリを起動しています...

REM プロジェクトディレクトリの存在確認
if not exist "E:\calender" (
    echo エラー: E:\calender ディレクトリが見つかりません
    pause
    exit /b 1
)

REM Anacondaのactivate.batの存在確認
if not exist "C:\Users\bokan\anaconda3\Scripts\activate.bat" (
    echo エラー: Anacondaのactivate.batが見つかりません
    echo パス: C:\Users\bokan\anaconda3\Scripts\activate.bat
    pause
    exit /b 1
)

REM バックエンドを新しいコマンドプロンプトで起動
echo バックエンドサーバーを起動中...
start "Backend Server" cmd /k "cd /d E:\calender\backend && C:\Users\bokan\anaconda3\Scripts\activate.bat calender && uvicorn app.main:app --reload --port 8001"

REM 少し待機（バックエンドが立ち上がるのを待つ）
timeout /t 5 > nul

REM フロントエンドを新しいコマンドプロンプトで起動
echo フロントエンドサーバーを起動中...
start "Frontend Server" cmd /k "cd /d E:\calender\frontend && npm run dev"

echo.
echo 起動完了！
echo フロントエンド: http://localhost:5175
echo バックエンドAPI: http://127.0.0.1:8001
echo.
echo 停止する場合は、各ウィンドウで Ctrl+C を押してください。
pause