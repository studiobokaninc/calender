"""add_dm_thread_participants

Revision ID: 20ca42b9c90d
Revises: 5730b6654716
Create Date: 2026-06-05 14:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20ca42b9c90d'
down_revision: Union[str, None] = '5730b6654716'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('dm_thread_participants',
    sa.Column('thread_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('thread_id', 'user_id')
    )


def downgrade() -> None:
    op.drop_table('dm_thread_participants')
