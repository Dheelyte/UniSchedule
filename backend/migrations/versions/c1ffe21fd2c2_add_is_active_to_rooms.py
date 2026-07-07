"""add is_active to rooms

Revision ID: c1ffe21fd2c2
Revises: l2g3h4i5j6k7
Create Date: 2026-07-07 14:15:51.239059

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1ffe21fd2c2'
down_revision: Union[str, Sequence[str], None] = 'l2g3h4i5j6k7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('rooms', sa.Column('is_active', sa.Boolean(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('rooms', 'is_active')
