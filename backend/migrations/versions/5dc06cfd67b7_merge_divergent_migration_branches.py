"""Merge divergent migration branches

Revision ID: 5dc06cfd67b7
Revises: 5511b67f3035, k1f2g3h4i5j6
Create Date: 2026-07-07 12:23:05.170099

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5dc06cfd67b7'
down_revision: Union[str, Sequence[str], None] = ('5511b67f3035', 'k1f2g3h4i5j6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
