"""add notification project_id

Revision ID: e2b3c4d5f6a7
Revises: d1a2b3c4e5f6
Create Date: 2026-06-22

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = 'e2b3c4d5f6a7'
down_revision = 'd1a2b3c4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    columns = [c['name'] for c in inspector.get_columns('notifications')]
    if 'project_id' not in columns:
        op.add_column('notifications', sa.Column('project_id', sa.Integer(), nullable=True))
    indexes = [i['name'] for i in inspector.get_indexes('notifications')]
    if 'ix_notifications_project_id' not in indexes:
        op.create_index('ix_notifications_project_id', 'notifications', ['project_id'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    indexes = [i['name'] for i in inspector.get_indexes('notifications')]
    if 'ix_notifications_project_id' in indexes:
        op.drop_index('ix_notifications_project_id', table_name='notifications')
    columns = [c['name'] for c in inspector.get_columns('notifications')]
    if 'project_id' in columns:
        op.drop_column('notifications', 'project_id')
