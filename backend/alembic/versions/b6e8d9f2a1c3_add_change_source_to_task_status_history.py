"""add change_source to task_status_history

Revision ID: b6e8d9f2a1c3
Revises: a3f7b2c1d4e5
Create Date: 2026-06-15
"""
from alembic import op
import sqlalchemy as sa

revision = 'b6e8d9f2a1c3'
down_revision = 'a3f7b2c1d4e5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('task_status_history', schema=None) as batch_op:
        batch_op.add_column(sa.Column('change_source', sa.String(), nullable=True, server_default='manual'))


def downgrade() -> None:
    with op.batch_alter_table('task_status_history', schema=None) as batch_op:
        batch_op.drop_column('change_source')
