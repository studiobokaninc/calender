"""create bug_reports

Revision ID: c7f9a0b3d2e4
Revises: b6e8d9f2a1c3
Create Date: 2026-06-15

"""
from alembic import op
import sqlalchemy as sa

revision = 'c7f9a0b3d2e4'
down_revision = 'b6e8d9f2a1c3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'bug_reports',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('reporter_user_id', sa.Integer(), nullable=False),
        sa.Column('reporter_name', sa.String(length=255), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('severity', sa.String(length=20), nullable=False, server_default='medium'),
        sa.Column('page_url', sa.String(length=1024), nullable=True),
        sa.Column('operation_log', sa.Text(), nullable=True),
        sa.Column('user_agent', sa.String(length=512), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='open'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['reporter_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_bug_reports_id', 'bug_reports', ['id'])
    op.create_index('ix_bug_reports_reporter_user_id', 'bug_reports', ['reporter_user_id'])
    op.create_index('ix_bug_reports_status', 'bug_reports', ['status'])
    op.create_index('ix_bug_reports_created_at', 'bug_reports', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_bug_reports_created_at', table_name='bug_reports')
    op.drop_index('ix_bug_reports_status', table_name='bug_reports')
    op.drop_index('ix_bug_reports_reporter_user_id', table_name='bug_reports')
    op.drop_index('ix_bug_reports_id', table_name='bug_reports')
    op.drop_table('bug_reports')
