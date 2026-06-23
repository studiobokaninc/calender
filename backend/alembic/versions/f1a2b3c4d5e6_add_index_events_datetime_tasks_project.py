"""add_index_events_datetime_tasks_project

Revision ID: f1a2b3c4d5e6
Revises: e2b3c4d5f6a7
Create Date: 2026-06-23

パフォーマンス改善: カレンダーページ高速化のため
- events.start_time / events.end_time へのインデックス追加（日付範囲フィルタ用）
- tasks.project_id へのインデックス追加（プロジェクト別タスク検索用）
- tasks.due_date / tasks.start_date へのインデックス追加（日付範囲フィルタ用）
"""
from alembic import op

revision = 'f1a2b3c4d5e6'
down_revision = 'e2b3c4d5f6a7'
branch_labels = None
depends_on = None


def upgrade():
    op.create_index('ix_events_start_time', 'events', ['start_time'], unique=False)
    op.create_index('ix_events_end_time', 'events', ['end_time'], unique=False)
    op.create_index('ix_tasks_project_id', 'tasks', ['project_id'], unique=False)
    op.create_index('ix_tasks_due_date', 'tasks', ['due_date'], unique=False)
    op.create_index('ix_tasks_start_date', 'tasks', ['start_date'], unique=False)


def downgrade():
    op.drop_index('ix_tasks_start_date', table_name='tasks')
    op.drop_index('ix_tasks_due_date', table_name='tasks')
    op.drop_index('ix_tasks_project_id', table_name='tasks')
    op.drop_index('ix_events_end_time', table_name='events')
    op.drop_index('ix_events_start_time', table_name='events')
