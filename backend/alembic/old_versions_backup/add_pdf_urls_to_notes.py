"""Add pdf_urls and pdf_positions to Note model

Revision ID: add_pdf_notes
Revises: xyz123abc456
Create Date: 2025-01-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_pdf_notes'
down_revision: Union[str, None] = 'xyz123abc456'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('notes', sa.Column('pdf_urls', sa.JSON(), nullable=True))
    op.add_column('notes', sa.Column('pdf_positions', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('notes', 'pdf_positions')
    op.drop_column('notes', 'pdf_urls')
