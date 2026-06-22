"""
fix_login_emails.py  --  cmd_553/554 Calendarログイン是正 DB スクリプト

【殿が踏む手順】
  1. Gitでコード是正を反映: サーバにてコード更新を確認 (git pull / ファイル配置)
  2. バックエンド再起動
  3. dry-run 実行 (引数なし): 診断のみ。変更はしない
       python fix_login_emails.py
  4. 適用実行:
       python fix_login_emails.py --apply
     uid28 の email を ryoji@studiobokan.com に設定する場合:
       python fix_login_emails.py --apply --set-uid28-email ryoji@studiobokan.com
  5. ログイン確認: ryoji@studiobokan.com + 既存パスワードでログインできること

注意: 本番サーバの .env に SECRET_KEY が設定されているか確認してください。
      未設定の場合は任意の長い文字列を設定するとセキュリティが向上します。

Usage:
  python fix_login_emails.py [options]

Options:
  --apply                  診断のみでなく実際に DB を更新する
  --yes                    適用前の確認プロンプト(y/N)をスキップ
  --set-uid28-email EMAIL  uid28 の email を EMAIL に設定(衝突確認あり)
  --db PATH                DB ファイルパスを手動指定(自動検出の代わり)
"""

import sys
import os
import re
import shutil
import sqlite3
import argparse
from pathlib import Path
from datetime import datetime


# ──────────────────────────────────────────────────────────────
# DB 自動検出
# ──────────────────────────────────────────────────────────────
def find_db_path(manual: str) -> Path:
    """SQLite DB ファイルを自動検出して返す。見つからない場合は終了する。"""
    if manual:
        p = Path(manual).resolve()
        if not p.exists():
            sys.exit(f"[ERROR] 指定 DB が見つかりません: {manual}\n"
                     f"  パスを確認してください。")
        return p

    # このスクリプトは backend/scripts/ に置く想定
    # scripts/ → parent が backend/
    script_dir = Path(__file__).resolve().parent
    backend_dir = script_dir.parent if (script_dir.parent / "app").exists() else script_dir

    # 候補1: backend/app/database.py を解析して DB ファイル名を取得
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

    # 候補2: .env の DATABASE_URL
    env_file = backend_dir / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip()
                m2 = re.search(r"sqlite(?:\+\w+)?:///(.+)", url)
                if m2:
                    raw = m2.group(1).strip()
                    p = Path(raw) if os.path.isabs(raw) else (backend_dir / raw).resolve()
                    if p.exists():
                        print(f"[INFO] DB を .env DATABASE_URL から検出: {p}")
                        return p

    # 候補3: alembic.ini の sqlalchemy.url
    alembic_ini = backend_dir / "alembic.ini"
    if alembic_ini.exists():
        for line in alembic_ini.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if line.startswith("sqlalchemy.url"):
                url = line.split("=", 1)[1].strip()
                m3 = re.search(r"sqlite(?:\+\w+)?:///(.+)", url)
                if m3:
                    raw = m3.group(1).strip()
                    p = Path(raw) if os.path.isabs(raw) else (backend_dir / raw).resolve()
                    if p.exists():
                        print(f"[INFO] DB を alembic.ini から検出: {p}")
                        return p

    # 候補4: よく使われる固定パス
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
        "  --db <path> で手動指定してください。\n"
        "  例 (Windows):\n"
        r'    python fix_login_emails.py --db "E:\calender\backend\app\project_management.db"'
    )


# ──────────────────────────────────────────────────────────────
# ユーティリティ
# ──────────────────────────────────────────────────────────────
def mask_hash(h) -> str:
    """パスワードハッシュを先頭10文字 + *** にマスクする。実値は表示しない。"""
    if not h:
        return "(null)"
    return str(h)[:10] + "***"


def show_diagnose(cur: sqlite3.Cursor, uid28_email) -> int:
    """現状を診断して表示し、正規化で変わる件数を返す。"""
    print("\n── 診断: uid28 の現状 ──")
    cur.execute(
        "SELECT id, name, email, hashed_password FROM users WHERE id = 28"
    )
    row = cur.fetchone()
    if row:
        print(f"  id={row[0]}, name={row[1]!r}, email={row[2]!r}, "
              f"hash_prefix={mask_hash(row[3])}")
    else:
        print("  uid28 は存在しません")

    print("\n── 診断: email = 'ryoji@studiobokan.com' 完全一致 ──")
    cur.execute(
        "SELECT id, name, email, hashed_password FROM users WHERE email = ?",
        ("ryoji@studiobokan.com",),
    )
    rows = cur.fetchall()
    if rows:
        for r in rows:
            print(f"  id={r[0]}, name={r[1]!r}, email={r[2]!r}, "
                  f"hash_prefix={mask_hash(r[3])}")
    else:
        print("  該当なし")

    print("\n── 診断: LOWER(TRIM(email)) = 'ryoji@studiobokan.com' 近似一致 ──")
    cur.execute(
        "SELECT id, name, email, hashed_password FROM users "
        "WHERE LOWER(TRIM(email)) = ?",
        ("ryoji@studiobokan.com",),
    )
    rows = cur.fetchall()
    if rows:
        for r in rows:
            print(f"  id={r[0]}, name={r[1]!r}, email={r[2]!r}, "
                  f"hash_prefix={mask_hash(r[3])}")
    else:
        print("  該当なし")

    cur.execute(
        "SELECT COUNT(*) FROM users WHERE email != LOWER(TRIM(email))"
    )
    affected = cur.fetchone()[0]
    print(f"\n── 正規化で変わる件数: {affected} 件 ──")

    # 正規化後に UNIQUE 違反になる重複を事前検出
    cur.execute(
        "SELECT LOWER(TRIM(email)) AS e, COUNT(*) AS c, GROUP_CONCAT(id) AS ids "
        "FROM users GROUP BY e HAVING c > 1"
    )
    dups = cur.fetchall()
    if dups:
        print("\n⚠ [警告] 正規化すると UNIQUE 違反になる重複があります:")
        for d in dups:
            print(f"  email={d[0]!r}, 件数={d[1]}, id一覧={d[2]}")
        print("  → --apply 実行前に重複を手動で解消してください。")
    else:
        print("  (正規化後の重複なし — 安全に --apply できます)")

    if uid28_email:
        normalized_target = uid28_email.lower().strip()
        print(f"\n── --set-uid28-email 衝突確認 ('{normalized_target}') ──")
        cur.execute(
            "SELECT id, name, email FROM users "
            "WHERE LOWER(TRIM(email)) = ? AND id != 28",
            (normalized_target,),
        )
        conflicts = cur.fetchall()
        if conflicts:
            print(f"  ⚠ 衝突あり! 以下のユーザーが同じ email を持っています:")
            for c in conflicts:
                print(f"    id={c[0]}, name={c[1]!r}, email={c[2]!r}")
        else:
            print(f"  衝突なし → uid28 に '{normalized_target}' を設定可能")

    return affected


def verify_after(cur: sqlite3.Cursor):
    """適用後の検証結果を表示する。"""
    print("\n── 検証: 適用後 email = 'ryoji@studiobokan.com' ──")
    cur.execute(
        "SELECT id, name, email, hashed_password FROM users WHERE email = ?",
        ("ryoji@studiobokan.com",),
    )
    rows = cur.fetchall()
    if rows:
        for r in rows:
            print(f"  id={r[0]}, name={r[1]!r}, email={r[2]!r}, "
                  f"hash_prefix={mask_hash(r[3])}")
        print("\n[SUCCESS] DB 正規化が完了しました。")
        print("  次の手順: ryoji@studiobokan.com + 既存パスワードでログインを確認してください。")
        print("  ※ パスワードは変更不要です。")
    else:
        print("  ⚠ ryoji@studiobokan.com がまだ見つかりません。")
        print("  uid28 のemailを設定するには --set-uid28-email を使用してください:")
        print(
            "    python fix_login_emails.py --apply "
            "--set-uid28-email ryoji@studiobokan.com"
        )


# ──────────────────────────────────────────────────────────────
# メイン
# ──────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        prog="fix_login_emails.py",
        description="Calendar ログイン是正 DB スクリプト (cmd_553/554)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="実際に DB を更新する (既定は dry-run: 診断のみ)"
    )
    parser.add_argument(
        "--yes", action="store_true",
        help="適用前の確認プロンプト (y/N) をスキップする"
    )
    parser.add_argument(
        "--set-uid28-email", metavar="EMAIL", dest="set_uid28_email",
        help="uid28 の email を EMAIL に設定する (衝突確認あり)"
    )
    parser.add_argument(
        "--db", metavar="PATH",
        help="DB ファイルパスを手動指定 (自動検出の代わり)"
    )
    args = parser.parse_args()

    db_path = find_db_path(args.db)
    print(f"[INFO] 対象 DB: {db_path}")

    uid28_email = (
        args.set_uid28_email.lower().strip() if args.set_uid28_email else None
    )

    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    affected = show_diagnose(cur, uid28_email)

    # ── dry-run 終了 ──────────────────────────────────────────
    if not args.apply:
        print(
            "\n[DRY-RUN] 変更は行いません。"
            " 実適用するには --apply を付けて実行してください。"
        )
        conn.close()
        return

    # ── 適用フェーズ ──────────────────────────────────────────

    # uid28 email 設定の衝突チェック
    if uid28_email:
        cur.execute(
            "SELECT COUNT(*) FROM users "
            "WHERE LOWER(TRIM(email)) = ? AND id != 28",
            (uid28_email,),
        )
        if cur.fetchone()[0] > 0:
            print(
                f"\n[ERROR] uid28 の email 設定を中止しました。\n"
                f"  '{uid28_email}' は既に他のユーザーが使用しています。"
            )
            conn.close()
            sys.exit(1)

    # 確認プロンプト
    if not args.yes:
        cur.execute("SELECT COUNT(*) FROM users")
        total = cur.fetchone()[0]
        print(f"\n[確認] users テーブル 全 {total} 件中 {affected} 件 の email を正規化します。")
        if uid28_email:
            print(f"       uid28 の email を '{uid28_email}' に設定します。")
        ans = input("続けますか？ [y/N]: ").strip().lower()
        if ans != "y":
            print("[中止] 操作をキャンセルしました。")
            conn.close()
            return

    # バックアップ
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = db_path.parent / f"{db_path.stem}_backup_{ts}{db_path.suffix}"
    shutil.copy2(str(db_path), str(backup_path))
    print(f"[BACKUP] バックアップ作成: {backup_path}")

    # トランザクション実行
    try:
        with conn:
            conn.execute("UPDATE users SET email = LOWER(TRIM(email))")
            if uid28_email:
                conn.execute(
                    "UPDATE users SET email = ? WHERE id = 28",
                    (uid28_email,),
                )
        print("[OK] 更新をコミットしました。")
    except Exception as e:
        print(f"[ERROR] 適用に失敗しました (ロールバック済み): {e}")
        conn.close()
        sys.exit(1)

    # 検証
    verify_after(cur)
    conn.close()


if __name__ == "__main__":
    main()
