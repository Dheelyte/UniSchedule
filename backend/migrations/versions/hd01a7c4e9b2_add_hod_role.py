"""Add the HOD role (Heads of Department, shown as "Faculty Viewer (HOD)")

Revision ID: hd01a7c4e9b2
Revises: s9n0o1p2q3r4
Create Date: 2026-11-22 00:00:00.000000

Only adds a value to the role enum. No existing account is changed, and the
previous version of the code never reads or writes the new value, so it keeps
working while this is applied.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'hd01a7c4e9b2'
down_revision: Union[str, Sequence[str], None] = 's9n0o1p2q3r4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TYPE roleenum ADD VALUE IF NOT EXISTS 'HOD'")


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres does not support removing enum values in-place. No-op.
    pass
