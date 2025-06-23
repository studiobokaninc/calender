#!/usr/bin/env python
# -*- coding: utf-8 -*-

import argparse
import json
import os
import sys
import requests
from datetime import datetime
from getpass import getpass

# APIのベースURL
API_BASE_URL = "http://localhost:8001"

def login(username, password=None):
    """APIにログインしてトークンを取得"""
    if not password:
        password = getpass("パスワードを入力してください: ")
    
    try:
        response = requests.post(
            f"{API_BASE_URL}/api/auth/token",
            data={"username": username, "password": password}
        )
        response.raise_for_status()
        return response.json()["access_token"]
    except requests.exceptions.RequestException as e:
        print(f"ログインエラー: {e}")
        if hasattr(e, 'response') and e.response:
            print(f"サーバーレスポンス: {e.response.text}")
        sys.exit(1)

def export_mock_data(token, output_file):
    """モックデータをエクスポート"""
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        response = requests.post(
            f"{API_BASE_URL}/admin/mock-data/export",
            headers=headers
        )
        response.raise_for_status()
        data = response.json()
        
        # 出力ファイル名が指定されていない場合は日時ベースで生成
        if not output_file:
            output_file = f"mock_data_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        # JSONファイルとして保存
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        print(f"モックデータを正常にエクスポートしました: {output_file}")
        return True
    except requests.exceptions.RequestException as e:
        print(f"エクスポートエラー: {e}")
        if hasattr(e, 'response') and e.response:
            print(f"サーバーレスポンス: {e.response.text}")
        return False

def import_mock_data(token, input_file):
    """JSONファイルからモックデータをインポート"""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    try:
        # JSONファイルを読み込み
        with open(input_file, 'r', encoding='utf-8') as f:
            import_data = json.load(f)
        
        # 基本的な構造確認
        required_keys = ["users", "projects", "tasks", "events"]
        for key in required_keys:
            if key not in import_data:
                print(f"エラー: インポートデータに必須キー '{key}' が含まれていません")
                return False
        
        # APIにデータを送信
        response = requests.post(
            f"{API_BASE_URL}/admin/mock-data/import",
            headers=headers,
            json=import_data
        )
        response.raise_for_status()
        
        print("モックデータを正常にインポートしました")
        return True
    except json.JSONDecodeError:
        print(f"エラー: ファイル '{input_file}' は有効なJSONではありません")
        return False
    except FileNotFoundError:
        print(f"エラー: ファイル '{input_file}' が見つかりません")
        return False
    except requests.exceptions.RequestException as e:
        print(f"インポートエラー: {e}")
        if hasattr(e, 'response') and e.response:
            print(f"サーバーレスポンス: {e.response.text}")
        return False

def create_mock_data_template(output_file):
    """新しいモックデータテンプレートを作成"""
    template = {
        "users": [
            {
                "id": "user-admin",
                "username": "admin@example.com",
                "full_name": "管理者ユーザー",
                "email": "admin@example.com",
                "role": "admin",
                "hashed_password": "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW"  # 'password123' のハッシュ
            },
            {
                "id": "user-1",
                "username": "user1@example.com",
                "full_name": "一般ユーザー 1",
                "email": "user1@example.com",
                "role": "user",
                "hashed_password": "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW"  # 'password123' のハッシュ
            }
        ],
        "projects": [
            {
                "id": "proj-template",
                "name": "テンプレートプロジェクト",
                "description": "新しいプロジェクトの説明文をここに入力",
                "status": "planning",
                "color": "#4CAF50",
                "startDate": datetime.now().strftime('%Y-%m-%d'),
                "endDate": (datetime.now().replace(month=datetime.now().month + 1)).strftime('%Y-%m-%d')
            }
        ],
        "tasks": [
            {
                "id": "task-template-1",
                "title": "サンプルタスク 1",
                "projectId": "proj-template",
                "taskStatus": "todo",
                "taskStartDate": datetime.now().strftime('%Y-%m-%d'),
                "taskDueDate": (datetime.now().replace(day=datetime.now().day + 7)).strftime('%Y-%m-%d'),
                "taskAssigneeId": "user-1",
                "taskCost": 8,
                "dependsOn": [],
                "statusHistory": [
                    {"status": "todo", "date": datetime.now().strftime('%Y-%m-%d')}
                ]
            }
        ],
        "events": [
            {
                "id": "event-template-1",
                "title": "サンプルイベント",
                "description": "イベントの説明文",
                "start": datetime.now().strftime('%Y-%m-%dT10:00:00'),
                "end": datetime.now().strftime('%Y-%m-%dT11:00:00'),
                "allDay": False,
                "type": "meeting",
                "location": "会議室A",
                "participants": [{"type": "user", "id": "user-1"}]
            }
        ],
        "groups": [
            {
                "id": "group-template",
                "name": "テンプレートグループ",
                "description": "グループの説明文"
            }
        ],
        "user_groups": [
            {
                "user_id": "user-1",
                "group_id": "group-template",
                "role": "member",
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }
        ]
    }
    
    # JSONファイルとして保存
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(template, f, ensure_ascii=False, indent=2)
    
    print(f"モックデータテンプレートを作成しました: {output_file}")
    return True

def main():
    parser = argparse.ArgumentParser(description='モックデータ管理ツール')
    
    # サブコマンドの設定
    subparsers = parser.add_subparsers(dest='command', help='コマンド')
    
    # エクスポートコマンド
    export_parser = subparsers.add_parser('export', help='モックデータのエクスポート')
    export_parser.add_argument('-u', '--username', help='APIログイン用のユーザー名', required=True)
    export_parser.add_argument('-p', '--password', help='APIログイン用のパスワード（指定しない場合はプロンプトで入力）')
    export_parser.add_argument('-o', '--output', help='出力ファイル名（指定しない場合は日時ベースで自動生成）')
    
    # インポートコマンド
    import_parser = subparsers.add_parser('import', help='モックデータのインポート')
    import_parser.add_argument('-u', '--username', help='APIログイン用のユーザー名', required=True)
    import_parser.add_argument('-p', '--password', help='APIログイン用のパスワード（指定しない場合はプロンプトで入力）')
    import_parser.add_argument('-i', '--input', help='インポートするJSONファイル', required=True)
    
    # テンプレート作成コマンド
    template_parser = subparsers.add_parser('template', help='モックデータテンプレートの作成')
    template_parser.add_argument('-o', '--output', help='出力ファイル名', default='mock_data_template.json')
    
    # コマンドライン引数の解析
    args = parser.parse_args()
    
    # コマンドに応じた処理
    if args.command == 'export':
        token = login(args.username, args.password)
        export_mock_data(token, args.output)
    elif args.command == 'import':
        token = login(args.username, args.password)
        import_mock_data(token, args.input)
    elif args.command == 'template':
        create_mock_data_template(args.output)
    else:
        parser.print_help()

if __name__ == '__main__':
    main() 