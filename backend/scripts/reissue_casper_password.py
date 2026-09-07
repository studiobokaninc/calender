"""
reissue_casper_password.py -- cmd_712 Casper(uid101) パスワード再発行スクリプト

【殿が踏む手順】
  1. サーバの本番環境で (backend/ ディレクトリから) 実行する:
       python scripts/reissue_casper_password.py
     既定は dry-run (診断のみ、DBは変更しない)。
  2. 診断内容 (uid101 の存在・role・is_active・email、SECRET_KEY 設定有無) を確認し、
     想定どおりであれば --apply を付けて再実行する:
       python scripts/reissue_casper_password.py --apply
  3. 実行すると新しい平文パスワードが画面に一度だけ表示される。
     ★この画面以外のどこにも記録されない (ログファイル・シェル履歴・標準出力の
     恒久的な記録には残さない設計)。その場でメモを取り、Score 陣へ安全な経路で
     渡すこと。再表示はできない (再実行すればまた新しいパスワードに変わる)。
  4. --verify (既定で有効) により、生成した直後にそのパスワードで実際に
     authenticate_user() + create_access_token() を通し、ログインが成立する
     ことをその場で自己検証する。

【前提条件チェック (実行冒頭で必ず表示)】
  - uid101 の存在・role・is_active・email の実値
  - SECRET_KEY が環境変数で明示設定されているか (未設定だとソース内既定値で
    署名される = 本番として不適切)
  想定 (role='admin', is_active=1, email='casper@example.com') と食い違う場合、
  または SECRET_KEY が未設定の場合は --apply していても実行を中止する。
  (想定と異なる状況で運用判断なしに書き換えるのを防ぐための安全策。
   想定が実際に変わった場合は --force で上書きできるが、殿の確認を経てから使うこと)

Usage:
  python reissue_casper_password.py            # dry-run (診断のみ)
  python reissue_casper_password.py --apply     # 実際にパスワードを再発行する
  python reissue_casper_password.py --apply --yes         # 確認プロンプトをスキップ
  python reissue_casper_password.py --apply --no-verify   # 再発行後の自己検証を省く
  python reissue_casper_password.py --apply --force       # 想定チェック不一致でも強行 (非推奨)
"""

import sys
import os
import secrets
import argparse
from pathlib import Path

# Windows コンソール (cp932既定) で日本語出力が文字化けするのを防ぐ
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# backend/ ディレクトリを sys.path に通し、app パッケージを解決できるようにする
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# main.py は起動時に backend/.env を dotenv でロードしてから security.py を import する
# (main.py: load_dotenv() → security.py の SECRET_KEY = os.getenv(...) の順)。
# 本スクリプトも同じ順序を再現しないと、実際には .env に設定されている SECRET_KEY を
# 「未設定」と誤診断してしまう。main.py と同一の対象パス (backend/.env) を明示的にロードする。
from dotenv import load_dotenv
load_dotenv(dotenv_path=_BACKEND_DIR / ".env")

EXPECTED_ROLE = "admin"
EXPECTED_IS_ACTIVE = True
EXPECTED_EMAIL = "casper@example.com"
UID = 101
PASSWORD_LENGTH_BYTES = 18  # secrets.token_urlsafe の入力バイト数 (十分な強度)


def main():
    parser = argparse.ArgumentParser(
        prog="reissue_casper_password.py",
        description="Casper (uid101) のパスワードを再発行する (cmd_712)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--apply", action="store_true",
                         help="実際に DB のパスワードを更新する (既定は dry-run)")
    parser.add_argument("--yes", action="store_true",
                         help="適用前の確認プロンプト (y/N) をスキップする")
    parser.add_argument("--no-verify", action="store_true",
                         help="再発行直後の自己検証 (ログイン試行) を省略する")
    parser.add_argument("--force", action="store_true",
                         help="前提条件チェック不一致でも強行する (非推奨・要事前確認)")
    args = parser.parse_args()

    # app パッケージのインポートは main.py 経由ではなく security/models/database を
    # 直接使う (main.py はルータ一式・スケジューラ等を起動しごく重い上に、
    # 開発環境(WSL)ではハングして起動できないことが判明している。
    # security.get_password_hash / authenticate_user はそれ単体で完結しており
    # main.py を経由しなくても本番と同一のコードパスで検証できる)。
    from app import security, models, database

    db = database.SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.id == UID).first()

        print("=" * 60)
        print("[前提条件チェック] uid101 の現況")
        print("=" * 60)
        if user is None:
            print(f"  [ERROR] uid={UID} のユーザーが見つかりません。")
            sys.exit(1)

        print(f"  id            = {user.id}")
        print(f"  username      = {user.username!r}")
        print(f"  email         = {user.email!r}")
        print(f"  role          = {user.role!r}")
        print(f"  is_active     = {user.is_active!r}")
        print(f"  hashed_password の長さ = {len(user.hashed_password) if user.hashed_password else 0}")

        secret_key_env = os.environ.get("SECRET_KEY")
        secret_key_set = bool(secret_key_env)
        print(f"  SECRET_KEY 環境変数    = {'設定済み' if secret_key_set else '★未設定 (ソース内既定値にフォールバックする)'}")

        mismatches = []
        if user.role != EXPECTED_ROLE:
            mismatches.append(f"role: 実際={user.role!r} / 想定={EXPECTED_ROLE!r}")
        if bool(user.is_active) != EXPECTED_IS_ACTIVE:
            mismatches.append(f"is_active: 実際={user.is_active!r} / 想定={EXPECTED_IS_ACTIVE!r}")
        if (user.email or "").lower() != EXPECTED_EMAIL:
            mismatches.append(f"email: 実際={user.email!r} / 想定={EXPECTED_EMAIL!r}")
        if not secret_key_set:
            mismatches.append("SECRET_KEY が環境変数で明示設定されていない")

        if mismatches:
            print("\n[前提条件不一致]")
            for m in mismatches:
                print(f"  - {m}")
            if not args.force:
                print("\n[ABORT] 想定と食い違うため実行を中止しました。"
                      "\n        状況を確認のうえ、必要なら --force で強行してください"
                      "\n        (--force は事前に状況を把握したうえでのみ使用すること)。")
                sys.exit(1)
            else:
                print("\n[WARN] --force が指定されたため、不一致のまま続行します。")

        if not args.apply:
            print("\n[DRY-RUN] 変更は行いません。実際にパスワードを再発行するには --apply を付けて実行してください。")
            return

        if not args.yes:
            ans = input(f"\n[確認] uid={UID} ({user.email}) のパスワードを再発行します。続けますか？ [y/N]: ").strip().lower()
            if ans != "y":
                print("[中止] 操作をキャンセルしました。")
                return

        # 新しい平文パスワードを生成する。
        # ★この変数の値はこの後、画面表示以外のいかなる場所 (ファイル・ログ・戻り値の
        #   永続化・環境変数への書き出し等) にも書き込まない。
        new_plain_password = secrets.token_urlsafe(PASSWORD_LENGTH_BYTES)

        new_hash = security.get_password_hash(new_plain_password)
        user.hashed_password = new_hash
        db.add(user)
        db.commit()
        db.refresh(user)
        print("\n[OK] パスワードを更新しました。")

        if not args.no_verify:
            print("\n[自己検証] 新しいパスワードで authenticate_user() + create_access_token() を実行します...")
            from datetime import timedelta
            authed = security.authenticate_user(db, username=user.email, password=new_plain_password)
            if not authed:
                print("  [ERROR] 自己検証に失敗しました。authenticate_user() が None/False を返しました。")
                sys.exit(1)
            token = security.create_access_token(
                data={"sub": authed.email},
                expires_delta=timedelta(minutes=security.ACCESS_TOKEN_EXPIRE_MINUTES),
            )
            # verify_token の通常JWT経路も直接通し、get_current_user 相当が成立することを確認する
            import asyncio
            verified_user = asyncio.run(
                security.verify_token(token, db, x_actor_user_id=None)
            )
            if verified_user.id != user.id:
                print("  [ERROR] verify_token() の結果が uid101 と一致しません。")
                sys.exit(1)
            print(f"  [OK] ログイン成立を確認 (POST /api/auth/token 相当・token長={len(token)}文字)。"
                  f" verify_token() で uid={verified_user.id} として解決されることも確認済み。")

        print("\n" + "=" * 60)
        print("新しい平文パスワード (この画面以外には記録されません。今すぐ控えてください):")
        print(f"\n    email    = {user.email}")
        print(f"    password = {new_plain_password}\n")
        print("=" * 60)
        print("このパスワードは再表示できません。安全な経路で Score 陣へお渡しください。")

    finally:
        db.close()


if __name__ == "__main__":
    main()
