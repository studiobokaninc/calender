"""
downgrade_casper_role_pending_approval.py -- cmd_712 論点2(イ)適用待ちスクリプト

★★★ 重要: 本スクリプトは cmd_712 の時点では一切実行しない。用意のみ。 ★★★
殿が docs/cmd_710_casper_auth_investigation.md §4 論点2 で
(イ) uid101(Casper) を role='user' へ降格し、必要なプロジェクトへ
    score_user_roles を付与する
を裁可された場合に、その適用作業をこのスクリプトで行う。

【降格すると失われる能力 (実行前に必ず読むこと)】
  uid101 は現在 role='admin'。admin には以下の効力があり、'user' へ降格すると
  いずれも失われる:
    1. X-Actor-User-Id ヘッダーによる代理操作
       (backend/app/routers/score.py:39-58 get_actor_user_id -- admin のみ有効。
        一般ユーザーが同ヘッダーを送っても無視され自分自身になる)
    2. 制作ステータス遷移・担当者変更のロールゲートの迂回
       (backend/app/crud/tasks.py の _actor_is_admin() チェックで admin は
        score_user_roles の割当が無くても通る)
    3. admin専用エンドポイント (24箇所: admin.py / score_admin.py / users.py /
       projects.py / groups.py / bug_reports.py) へのアクセス
  → **Casper が「他人の名義で」書込・DM送信を行う設計である場合、この降格は
     その用途を壊す。** Score 陣の実際の用途(依頼事項3, 回答草案参照)を
     確認してから適用すること。

【本スクリプトが行うこと (--apply 時)】
  1. uid101 の role を 'admin' → 'user' へ変更
  2. 指定された project_id + role の score_user_roles エントリを付与
     (--grant project_id:role の形式で複数指定可。例: --grant 12:pm --grant 7:lead)
     role は status_transitions.ROLE_ALIASES の正準名 (director/pm/lead/compositor/
     artist/help) のいずれかである必要がある。
  3. 適用前に自動でDBバックアップを取る (backend/backups/)

【役職不付与のまま降格した場合の注意】
  --grant を一つも指定しない場合、Casper は「制作役職も admin 権限も無い」
  状態になり、score_user_roles によるゲートが fail-closed で全て拒否される
  (crud/tasks.py:_actor_project_role: 未割当は None=拒否)。用途に応じた
  project_id:role を必ず指定すること。

Usage:
  python downgrade_casper_role_pending_approval.py --grant 12:pm --grant 7:lead
      # dry-run (診断のみ、DBは変更しない)
  python downgrade_casper_role_pending_approval.py --grant 12:pm --apply
      # 実際に適用する
  python downgrade_casper_role_pending_approval.py --apply --yes
      # 役職付与なしで role のみ降格 (非推奨・上記「役職不付与」の注意を読むこと)
"""

import sys
import os
import shutil
import argparse
from pathlib import Path
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

UID = 101
CANONICAL_ROLES = {"director", "pm", "lead", "compositor", "artist", "help"}


def parse_grant(spec: str):
    if ":" not in spec:
        raise argparse.ArgumentTypeError(f"--grant は project_id:role 形式で指定してください (例: 12:pm): {spec!r}")
    pid_str, role = spec.split(":", 1)
    if not pid_str.isdigit():
        raise argparse.ArgumentTypeError(f"project_id は整数である必要があります: {spec!r}")
    if role not in CANONICAL_ROLES:
        raise argparse.ArgumentTypeError(
            f"role は {sorted(CANONICAL_ROLES)} のいずれかである必要があります: {spec!r}"
        )
    return int(pid_str), role


def main():
    parser = argparse.ArgumentParser(
        prog="downgrade_casper_role_pending_approval.py",
        description="Casper(uid101) role降格 + score_user_roles付与 (cmd_712 論点2(イ) 適用待ち)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--apply", action="store_true", help="実際に適用する (既定は dry-run)")
    parser.add_argument("--yes", action="store_true", help="確認プロンプトをスキップする")
    parser.add_argument("--grant", action="append", default=[], type=parse_grant,
                         metavar="PROJECT_ID:ROLE",
                         help="付与する project_id:role (複数指定可)")
    args = parser.parse_args()

    from app import security, models, database

    db = database.SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.id == UID).first()
        if user is None:
            print(f"[ERROR] uid={UID} が見つかりません。")
            sys.exit(1)

        print("=" * 60)
        print("[現況] uid101")
        print("=" * 60)
        print(f"  role (現在)       = {user.role!r}")
        print(f"  is_active         = {user.is_active!r}")
        existing_roles = db.query(models.ScoreUserRole).filter(models.ScoreUserRole.user_id == UID).all()
        print(f"  score_user_roles (現在) = {[(r.project_id, r.role) for r in existing_roles]}")

        print("\n[予定される変更]")
        print(f"  role: {user.role!r} -> 'user'")
        if args.grant:
            for pid, role in args.grant:
                proj = db.query(models.Project).filter(models.Project.id == pid).first()
                proj_name = proj.name if proj else "★存在しないproject_id★"
                print(f"  score_user_roles 追加: project_id={pid} ({proj_name}), role={role!r}")
        else:
            print("  score_user_roles: 追加なし"
                  "\n  ★警告: 役職を一つも付与しないまま降格すると、Casper は"
                  "\n         全プロジェクトで fail-closed により拒否される状態になります。")

        if not args.apply:
            print("\n[DRY-RUN] 変更は行いません。適用するには --apply を付けて実行してください。")
            return

        missing_projects = [pid for pid, _ in args.grant
                             if db.query(models.Project).filter(models.Project.id == pid).first() is None]
        if missing_projects:
            print(f"\n[ABORT] 存在しない project_id が指定されています: {missing_projects}")
            sys.exit(1)

        if not args.yes:
            ans = input("\n[確認] 上記の変更を適用します。続けますか？ [y/N]: ").strip().lower()
            if ans != "y":
                print("[中止] 操作をキャンセルしました。")
                return

        db_path = database.DATABASE_FILE_PATH
        if db_path.exists():
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_dir = _BACKEND_DIR / "backups"
            backup_dir.mkdir(exist_ok=True)
            backup_path = backup_dir / f"pre_casper_downgrade_{ts}_{db_path.name}"
            shutil.copy2(str(db_path), str(backup_path))
            print(f"[BACKUP] {backup_path}")

        user.role = "user"
        db.add(user)

        for pid, role in args.grant:
            exists = db.query(models.ScoreUserRole).filter(
                models.ScoreUserRole.user_id == UID,
                models.ScoreUserRole.project_id == pid,
            ).first()
            if exists:
                exists.role = role
                print(f"  [UPDATE] project_id={pid} の既存ロールを {role!r} に更新")
            else:
                db.add(models.ScoreUserRole(user_id=UID, project_id=pid, role=role))
                print(f"  [INSERT] project_id={pid} role={role!r} を追加")

        db.commit()
        print("\n[OK] 適用しました。")

        db.refresh(user)
        print(f"  role (更新後) = {user.role!r}")
        final_roles = db.query(models.ScoreUserRole).filter(models.ScoreUserRole.user_id == UID).all()
        print(f"  score_user_roles (更新後) = {[(r.project_id, r.role) for r in final_roles]}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
