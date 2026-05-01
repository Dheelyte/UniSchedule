"""Merge multiple heads

Revision ID: fa8474ebeb56
Revises: b220b5b21cac, h8c9d0e1f2g3
Create Date: 2026-05-01 22:36:53.750802

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fa8474ebeb56'
down_revision: Union[str, Sequence[str], None] = ('b220b5b21cac', 'h8c9d0e1f2g3')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
