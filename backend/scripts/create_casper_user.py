"""
create_casper_user.py  --  cmd_676 Casper専用system user新設 DB スクリプト

【殿が踏む手順】
  1. Gitでコード是正を反映: サーバにてコード更新を確認 (git pull / ファイル配置)
  2. バックエンド再起動
  3. dry-run 実行 (引数なし): 診断のみ。変更はしない
       python create_casper_user.py
  4. 適用実行:
       python create_casper_user.py --apply
  5. 出力された uid を CASPER_WRITE_TOKEN 経由の呼出 (X-Actor-User-Id) に使用する

冪等性: username='casper' の行が既に存在する場合は何もせず既存 uid を表示して終了する
        (再実行しても重複作成されない)。

Usage:
  python create_casper_user.py [options]

Options:
  --apply     診断のみでなく実際に DB へ行追加する
  --yes       適用前の確認プロンプト(y/N)をスキップ
  --db PATH   DB ファイルパスを手動指定(自動検出の代わり)
  --email     email を明示指定 (既定: casper@example.com)
"""

import sys
import os
import re
import shutil
import sqlite3
import argparse
import secrets
from pathlib import Path
from datetime import datetime

DEFAULT_EMAIL = "casper@example.com"
USERNAME = "casper"
FULL_NAME = "Casper"
ROLE = "system"


# ──────────────────────────────────────────────────────────────
# DB 自動検出 (fix_login_emails.py と同一ロジック)
# ──────────────────────────────────────────────────────────────
def find_db_path(manual: str) -> Path:
    """SQLite DB ファイルを自動検出して返す。見つからない場合は終了する。"""
    if manual:
        p = Path(manual).resolve()
        if not p.exists():
            sys.exit(f"[ERROR] 指定 DB が見つかりません: {manual}\n"
                     f"  パスを確認してください。")
        return p

    script_dir = Path(__file__).resolve().parent
    backend_dir = script_dir.parent if (script_dir.parent / "app").exists() else script_dir

    db_py = backend_dir / "app" / "database.py"
    if db_py.exists():
        text = db_py.read_text(encoding="utf-8", errors="replace")
        m = re.search(
            r'DATABASE_FILE_PATH\s*=\s*DATABASE_DIR\s*/\s*["\']([^"\']+)["\']', text
        )
        if m:
            candidate = (backend_dir / "app" / m.group(1)).resolve()
            if candidate.exists():
                print(f"[INFO] DB を database.py から検出: {candidate}")
                return candidate

    for cand in [
        backend_dir / "app" / "project_management.db",
        backend_dir / "sql_app.db",
        backend_dir / "app" / "sql_app.db",
    ]:
        if cand.exists():
            print(f"[INFO] DB を既定パスから検出: {cand}")
            return cand.resolve()

    sys.exit(
        "[ERROR] SQLite DB ファイルが自動検出できませんでした。\n"
        "  --db <path> で手動指定してください。"
    )


def make_password_hash() -> str:
    """ログイン不能な system アカウント用に、ランダムかつ破棄されるパスワードを argon2 でハッシュ化する。
    実パスワード値はどこにも保存・出力しない (誰にも知られない = ログイン手段として機能しない)。"""
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")
    random_secret = secrets.token_urlsafe(32)
    return pwd_context.hash(random_secret)


def main():
    parser = argparse.ArgumentParser(
        prog="create_casper_user.py",
        description="Casper専用 system user 新設スクリプト (cmd_676)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--apply", action="store_true",
                         help="実際に DB へ行追加する (既定は dry-run: 診断のみ)")
    parser.add_argument("--yes", action="store_true",
                         help="適用前の確認プロンプト (y/N) をスキップする")
    parser.add_argument("--db", metavar="PATH",
                         help="DB ファイルパスを手動指定 (自動検出の代わり)")
    parser.add_argument("--email", metavar="EMAIL", default=DEFAULT_EMAIL,
                         help=f"casper アカウントの email (既定: {DEFAULT_EMAIL})")
    args = parser.parse_args()

    db_path = find_db_path(args.db)
    print(f"[INFO] 対象 DB: {db_path}")

    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    # ── 冪等性チェック: username='casper' が既に存在するか ──
    cur.execute("SELECT id, username, email, role, is_active FROM users WHERE username = ?", (USERNAME,))
    existing = cur.fetchone()
    if existing:
        print(f"\n[SKIP] username='{USERNAME}' は既に存在します。新規作成しません。")
        print(f"  既存 uid={existing[0]}, email={existing[2]!r}, role={existing[3]!r}, is_active={existing[4]}")
        conn.close()
        return

    # email 衝突チェック
    cur.execute("SELECT id FROM users WHERE email = ?", (args.email,))
    if cur.fetchone():
        sys.exit(f"[ERROR] email='{args.email}' は既に別ユーザーが使用しています。--email で別のアドレスを指定してください。")

    print(f"\n[診断] 新規作成予定の内容:")
    print(f"  username    = {USERNAME!r}")
    print(f"  full_name   = {FULL_NAME!r}")
    print(f"  email       = {args.email!r}")
    print(f"  role        = {ROLE!r} (admin権限なし・既存の role=='admin' 判定には一致しない)")
    print(f"  is_active   = 1")
    print(f"  hashed_password = ランダム生成 (誰にも知られないため実質ログイン不可)")

    if not args.apply:
        print("\n[DRY-RUN] 変更は行いません。実適用するには --apply を付けて実行してください。")
        conn.close()
        return

    if not args.yes:
        ans = input(f"\n[確認] username='{USERNAME}' (email='{args.email}') を新規作成します。続けますか？ [y/N]: ").strip().lower()
        if ans != "y":
            print("[中止] 操作をキャンセルしました。")
            conn.close()
            return

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = db_path.parent / f"{db_path.stem}_backup_{ts}{db_path.suffix}"
    shutil.copy2(str(db_path), str(backup_path))
    print(f"[BACKUP] バックアップ作成: {backup_path}")

    password_hash = make_password_hash()

    try:
        with conn:
            conn.execute(
                "INSERT INTO users (name, email, hashed_password, role, username, full_name, is_active, "
                "base_load_hours_per_week, google_linked) VALUES (?, ?, ?, ?, ?, ?, 1, 0.0, 0)",
                (FULL_NAME, args.email, password_hash, ROLE, USERNAME, FULL_NAME),
            )
        print("[OK] 追加をコミットしました。")
    except Exception as e:
        print(f"[ERROR] 適用に失敗しました (ロールバック済み): {e}")
        conn.close()
        sys.exit(1)

    cur.execute("SELECT id, username, email, role, is_active FROM users WHERE username = ?", (USERNAME,))
    row = cur.fetchone()
    print(f"\n[SUCCESS] casper ユーザーを作成しました。 uid={row[0]}, email={row[2]!r}, role={row[3]!r}")
    print(f"  この uid={row[0]} を Casper の X-Actor-User-Id / actor_id として使用してください。")
    conn.close()


if __name__ == "__main__":
    main()
