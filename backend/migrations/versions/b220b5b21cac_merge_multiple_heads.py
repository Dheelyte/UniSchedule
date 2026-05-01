"""merge multiple heads

Revision ID: b220b5b21cac
Revises: c7d8e9f0a1b2, g7b8c9d0e1f2
Create Date: 2026-05-01 07:56:01.935280

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b220b5b21cac'
down_revision: Union[str, Sequence[str], None] = ('c7d8e9f0a1b2', 'g7b8c9d0e1f2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
