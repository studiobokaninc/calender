"""task status redesign v2: collapse 19 states -> 9 states (+ client_ap)

Revision ID: j9status0001v2
Revises: i1a2b3c4d5e6
Create Date: 2026-07-16

docs/task_status_redesign_v2_plan.md に基づき、旧19体系を新9体系へ集約する。
  有効9値: wt / mk / wip / qc / qc_fb / ap / client_ap / deliver / omit

  modeling/lookdev/caching/rig/facial -> wip
  v1qc / dir_wt                        -> qc
  ap_fb / dir_fb / fix                 -> qc_fb
  dir_ap                               -> ap
  (wt/mk/wip/qc/qc_fb/ap/deliver/omit はそのまま)

併せて:
  - 廃止された中間 shot ステータス 'approved' を 'in_progress' へ (§6)
  - completed_at バックフィルを完了カテゴリ {ap, client_ap, deliver} へ拡張 (§3.1)

NOTE: 本番の SQLite DB は起動時の app/db_auto_migrate.py（冪等）でも同一処理を適用する。
      本リビジョンは他環境/追跡用。SQLAlchemy Enum は NAME(大文字)で保存されるため
      LOWER 照合し大文字 NAME を書き込む。
"""
from alembic import op
import sqlalchemy as sa


revision = 'j9status0001v2'
down_revision = 'i1a2b3c4d5e6'
branch_labels = None
depends_on = None


# 旧値(小文字化後) -> 新値(大文字 = Enum NAME)。既に新9値のものは素通し。
_COLLAPSE = {
    'modeling': 'WIP', 'lookdev': 'WIP', 'caching': 'WIP', 'rig': 'WIP', 'facial': 'WIP',
    'v1qc': 'QC', 'dir_wt': 'QC',
    'ap_fb': 'QC_FB', 'dir_fb': 'QC_FB', 'fix': 'QC_FB',
    'dir_ap': 'AP',
}


def _case_expr(column: str) -> str:
    whens = " ".join(f"WHEN LOWER({column}) = '{old}' THEN '{new}'" for old, new in _COLLAPSE.items())
    return "CASE " + whens + f" ELSE {column} END"


def upgrade() -> None:
    bind = op.get_bind()
    in_list = ",".join(f"'{k}'" for k in _COLLAPSE)

    # 1) tasks.status / task_status_history.status を新9体系へ集約
    for tbl in ("tasks", "task_status_history"):
        bind.execute(sa.text(
            f"UPDATE {tbl} SET status = {_case_expr('status')} WHERE LOWER(status) IN ({in_list})"
        ))

    # 2) 廃止された shot ステータス 'approved' -> 'in_progress'
    bind.execute(sa.text("UPDATE shots SET status = 'in_progress' WHERE LOWER(status) = 'approved'"))

    # 3) completed_at を完了カテゴリ {ap, client_ap, deliver} でバックフィル
    bind.execute(sa.text(
        "UPDATE tasks SET completed_at = ("
        "  SELECT MIN(changed_at) FROM task_status_history h"
        "  WHERE h.task_id = tasks.id AND LOWER(h.status) IN ('ap','client_ap','deliver')"
        ") WHERE LOWER(status) IN ('ap','client_ap','deliver') AND completed_at IS NULL"
    ))


def downgrade() -> None:
    """集約は不可逆（複数の旧値が1つの新値へ畳み込まれるため元に戻せない）。
    no-op とする。"""
    pass
