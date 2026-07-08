"""Add CITS_ADMIN role

Revision ID: 5dc06cfd67b8
Revises: 5dc06cfd67b7
Create Date: 2026-07-07 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = '5dc06cfd67b8'
down_revision: Union[str, Sequence[str], None] = '5dc06cfd67b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TYPE roleenum ADD VALUE IF NOT EXISTS 'CITS_ADMIN'")


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres does not support removing enum values in-place. No-op.
    pass
