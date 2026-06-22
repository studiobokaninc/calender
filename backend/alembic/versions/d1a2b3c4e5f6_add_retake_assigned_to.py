"""add retake assigned_to

Revision ID: d1a2b3c4e5f6
Revises: c7f9a0b3d2e4
Create Date: 2026-06-22

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = 'd1a2b3c4e5f6'
down_revision = 'c7f9a0b3d2e4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    columns = [c['name'] for c in inspector.get_columns('retakes')]
    if 'assigned_to' not in columns:
        op.add_column('retakes', sa.Column('assigned_to', sa.Integer(), nullable=True))
    indexes = [i['name'] for i in inspector.get_indexes('retakes')]
    if 'ix_retakes_assigned_to' not in indexes:
        op.create_index('ix_retakes_assigned_to', 'retakes', ['assigned_to'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    indexes = [i['name'] for i in inspector.get_indexes('retakes')]
    if 'ix_retakes_assigned_to' in indexes:
        op.drop_index('ix_retakes_assigned_to', table_name='retakes')
    columns = [c['name'] for c in inspector.get_columns('retakes')]
    if 'assigned_to' in columns:
        op.drop_column('retakes', 'assigned_to')
