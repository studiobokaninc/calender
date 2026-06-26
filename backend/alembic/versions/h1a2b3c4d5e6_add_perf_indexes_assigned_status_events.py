"""add_perf_indexes_assigned_status_events

Revision ID: h1a2b3c4d5e6
Revises: g1a2b3c4d5e6
Create Date: 2026-06-26

パフォーマンス改善: assigned_to / status / events.project_id へのインデックス追加
- tasks.assigned_to: score.py・external.py の /me/* 系クエリで多用される FK 列
- tasks.status: ステータスフィルタ用（TaskStatus enum 列、既存 index なし）
- events.project_id: イベントのプロジェクト別検索用 FK 列
"""
from alembic import op

revision = 'h1a2b3c4d5e6'
down_revision = 'g1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_index('ix_tasks_assigned_to', 'tasks', ['assigned_to'], unique=False)
    op.create_index('ix_tasks_status', 'tasks', ['status'], unique=False)
    op.create_index('ix_events_project_id', 'events', ['project_id'], unique=False)


def downgrade():
    op.drop_index('ix_events_project_id', table_name='events')
    op.drop_index('ix_tasks_status', table_name='tasks')
    op.drop_index('ix_tasks_assigned_to', table_name='tasks')
