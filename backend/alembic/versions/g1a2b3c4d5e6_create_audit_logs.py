"""create audit_logs table

Revision ID: g1a2b3c4d5e6
Revises: f1a2b3c4d5e6
Create Date: 2026-06-25
"""
from alembic import op
import sqlalchemy as sa

revision = 'g1a2b3c4d5e6'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('ts', sa.DateTime(), nullable=False),
        sa.Column('actor_uid', sa.Integer(), nullable=True),
        sa.Column('action', sa.String(100), nullable=False),
        sa.Column('target_type', sa.String(50), nullable=True),
        sa.Column('target_id', sa.Integer(), nullable=True),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('level', sa.String(10), nullable=False, server_default='info'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_audit_logs_id', 'audit_logs', ['id'])
    op.create_index('ix_audit_logs_ts', 'audit_logs', ['ts'])
    op.create_index('ix_audit_logs_actor_uid', 'audit_logs', ['actor_uid'])
    op.create_index('ix_audit_logs_action', 'audit_logs', ['action'])


def downgrade() -> None:
    op.drop_index('ix_audit_logs_action', 'audit_logs')
    op.drop_index('ix_audit_logs_actor_uid', 'audit_logs')
    op.drop_index('ix_audit_logs_ts', 'audit_logs')
    op.drop_index('ix_audit_logs_id', 'audit_logs')
    op.drop_table('audit_logs')
