"""Add is_special flag to faculties

Revision ID: l2g3h4i5j6k7
Revises: 5dc06cfd67b7
Create Date: 2026-07-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'l2g3h4i5j6k7'
down_revision: Union[str, Sequence[str], None] = '5dc06cfd67b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('faculties', sa.Column('is_special', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('faculties', 'is_special')
