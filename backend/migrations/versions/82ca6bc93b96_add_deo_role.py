"""add DEO role

Revision ID: 82ca6bc93b96
Revises: m3h4i5j6k7l8
Create Date: 2026-10-09 16:47:52.518268

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '82ca6bc93b96'
down_revision: Union[str, Sequence[str], None] = 'm3h4i5j6k7l8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TYPE roleenum ADD VALUE IF NOT EXISTS 'DEO'")


def downgrade() -> None:
    """Downgrade schema."""
    pass
