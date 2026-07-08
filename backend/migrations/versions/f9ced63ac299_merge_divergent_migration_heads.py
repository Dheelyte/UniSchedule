"""Merge divergent migration heads

Revision ID: f9ced63ac299
Revises: 5dc06cfd67b8, c1ffe21fd2c2
Create Date: 2026-07-08 01:26:11.931586

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f9ced63ac299'
down_revision: Union[str, Sequence[str], None] = ('5dc06cfd67b8', 'c1ffe21fd2c2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
