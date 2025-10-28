"""
最近のエラーログを表示
"""
import sys

try:
    with open('app.log', 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    # 最後の100行を取得
    recent_lines = lines[-100:]
    
    print("=" * 80)
    print("最近のログ（最後の100行）")
    print("=" * 80)
    
    for line in recent_lines:
        if 'ERROR' in line or 'Traceback' in line or 'Exception' in line:
            print(line.rstrip())
        
except Exception as e:
    print(f"エラー: {str(e)}")
    sys.exit(1)

