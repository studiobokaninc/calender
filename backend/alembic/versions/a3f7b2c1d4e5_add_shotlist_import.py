"""add shotlist import columns

Revision ID: a3f7b2c1d4e5
Revises: 20ca42b9c90d
Create Date: 2026-06-10
"""
from alembic import op
import sqlalchemy as sa

revision = 'a3f7b2c1d4e5'
down_revision = '20ca42b9c90d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('shots', schema=None) as batch_op:
        batch_op.add_column(sa.Column('cut', sa.String(20), nullable=True))
        batch_op.add_column(sa.Column('sl_no', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('frame_in', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('frame_out', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('duration', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('second', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('frame_rem', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('action', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('dialogue', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('bg', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('ch', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('prop', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('task_lay', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('task_anim', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('task_fx', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('task_lighting', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('task_comp', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('note', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('is_deleted',
            sa.Boolean(create_constraint=False), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('deleted_at', sa.DateTime(), nullable=True))
        batch_op.create_index('ix_shots_cut', ['cut'])

    op.create_table(
        'project_column_settings',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('field_key', sa.String(30), nullable=False),
        sa.Column('is_enabled', sa.Boolean(create_constraint=False),
                  nullable=False, server_default='1'),
        sa.Column('display_order', sa.Integer(), nullable=True),
        sa.Column('display_label', sa.String(50), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'field_key', name='uix_pcs_project_field'),
    )
    op.create_index('ix_pcs_project_id', 'project_column_settings', ['project_id'])


def downgrade() -> None:
    op.drop_index('ix_pcs_project_id', table_name='project_column_settings')
    op.drop_table('project_column_settings')
    with op.batch_alter_table('shots', schema=None) as batch_op:
        batch_op.drop_index('ix_shots_cut')
        batch_op.drop_column('deleted_at')
        batch_op.drop_column('is_deleted')
        batch_op.drop_column('note')
        batch_op.drop_column('task_comp')
        batch_op.drop_column('task_lighting')
        batch_op.drop_column('task_fx')
        batch_op.drop_column('task_anim')
        batch_op.drop_column('task_lay')
        batch_op.drop_column('prop')
        batch_op.drop_column('ch')
        batch_op.drop_column('bg')
        batch_op.drop_column('dialogue')
        batch_op.drop_column('action')
        batch_op.drop_column('frame_rem')
        batch_op.drop_column('second')
        batch_op.drop_column('duration')
        batch_op.drop_column('frame_out')
        batch_op.drop_column('frame_in')
        batch_op.drop_column('sl_no')
        batch_op.drop_column('cut')
