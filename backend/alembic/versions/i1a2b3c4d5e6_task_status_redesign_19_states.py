"""task status redesign to 19 states (mk/wip/.../deliver)

Revision ID: i1a2b3c4d5e6
Revises: h1a2b3c4d5e6
Create Date: 2026-07-07

Migrates tasks.status and task_status_history.status from the legacy 7-state
scheme (todo/in-progress/review/approved/completed/delayed/retake) to the new
19-state CG/VFX pipeline scheme defined in docs/task_status_redesign_plan.md.

Also resets auto_delayed to False (0) on all task rows because the automatic
delayed-status transition is discontinued in the new design.
"""
from alembic import op
import sqlalchemy as sa


revision = 'i1a2b3c4d5e6'
down_revision = 'h1a2b3c4d5e6'
branch_labels = None
depends_on = None


# 旧値(小文字化後) → 新値(大文字=Enum NAME 形式)。
# SQLAlchemy の Enum カラムは既定で Enum の NAME を DB に保存するため、
# tasks.status には物理値 ('mk' 等) ではなく NAME ('MK' 等) を書き込む必要がある。
# SQL 側で LOWER() をかけてから照合し、大文字 Enum 名 (TODO/IN_PROGRESS/...) と
# 物理値 (todo/in-progress/...) の混在に対応する。
_OLD_TO_NEW = {
    'todo': 'MK',
    'in-progress': 'WIP',
    'in_progress': 'WIP',
    'review': 'QC',
    'approved': 'AP',
    'completed': 'DELIVER',
    'delayed': 'WIP',
    'retake': 'QC_FB',
    'cashing': 'CACHING',
    # 旧マイグレーションで誤って小文字を書き込んだレコードの救済 (idempotent)
    'mk': 'MK', 'wip': 'WIP', 'qc': 'QC', 'qc_fb': 'QC_FB',
    'ap': 'AP', 'ap_fb': 'AP_FB', 'deliver': 'DELIVER',
    'modeling': 'MODELING', 'lookdev': 'LOOKDEV', 'caching': 'CACHING',
    'rig': 'RIG', 'facial': 'FACIAL', 'v1qc': 'V1QC',
    'dir_wt': 'DIR_WT', 'dir_ap': 'DIR_AP', 'dir_fb': 'DIR_FB',
    'fix': 'FIX', 'omit': 'OMIT', 'wt': 'WT',
}


def _build_case_expr(column: str) -> str:
    """LOWER(column) を各旧値と照合する CASE 式を組み立てる。既に新体系のものは素通し。"""
    whens = []
    for old, new in _OLD_TO_NEW.items():
        whens.append(f"WHEN LOWER({column}) = '{old}' THEN '{new}'")
    return "CASE " + " ".join(whens) + f" ELSE {column} END"


def upgrade() -> None:
    bind = op.get_bind()

    # 1) tasks.status を新体系へ一括変換
    expr = _build_case_expr('status')
    bind.execute(sa.text(f"UPDATE tasks SET status = {expr}"))

    # 2) task_status_history.status も同様に変換
    bind.execute(sa.text(f"UPDATE task_status_history SET status = {expr}"))

    # 3) auto_delayed カラム値を全レコードで False にリセット
    #    (現場の意図しないステータス変更を防ぐため自動遅延処理は廃止)
    bind.execute(sa.text("UPDATE tasks SET auto_delayed = 0"))


def downgrade() -> None:
    """新体系→旧体系への best-effort 逆変換。工程別ステータス (modeling/lookdev/...)
    や新設ステータス (omit/wt/v1qc/ap_fb/dir_*/fix) は旧体系に存在しないため、
    最も近い旧値へ丸める (情報損失あり)。
    """
    # 新体系(NAME・大文字) → 旧体系(NAME・大文字)。
    reverse_map = {
        'mk': 'TODO',
        'wip': 'IN_PROGRESS',
        'modeling': 'IN_PROGRESS',
        'lookdev': 'IN_PROGRESS',
        'caching': 'IN_PROGRESS',
        'rig': 'IN_PROGRESS',
        'facial': 'IN_PROGRESS',
        'wt': 'IN_PROGRESS',
        'v1qc': 'REVIEW',
        'qc': 'REVIEW',
        'qc_fb': 'RETAKE',
        'ap': 'APPROVED',
        'ap_fb': 'RETAKE',
        'dir_wt': 'REVIEW',
        'dir_ap': 'APPROVED',
        'dir_fb': 'RETAKE',
        'fix': 'APPROVED',
        'deliver': 'COMPLETED',
        'omit': 'COMPLETED',
    }

    def _reverse_expr(column: str) -> str:
        whens = " ".join(
            f"WHEN LOWER({column}) = '{k}' THEN '{v}'" for k, v in reverse_map.items()
        )
        return "CASE " + whens + f" ELSE {column} END"

    bind = op.get_bind()
    bind.execute(sa.text(f"UPDATE tasks SET status = {_reverse_expr('status')}"))
    bind.execute(sa.text(f"UPDATE task_status_history SET status = {_reverse_expr('status')}"))
