"""Add active/inactive seat breakdown to rooms

Revision ID: m3h4i5j6k7l8
Revises: f9ced63ac299
Create Date: 2026-07-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'm3h4i5j6k7l8'
down_revision: Union[str, Sequence[str], None] = 'f9ced63ac299'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('rooms', sa.Column('active_seats', sa.Integer(), server_default='0', nullable=False))
    op.add_column('rooms', sa.Column('inactive_seats', sa.Integer(), server_default='0', nullable=False))
    # Existing rooms: treat the whole current capacity as active (good) seats.
    op.execute("UPDATE rooms SET active_seats = COALESCE(capacity, 0)")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('rooms', 'inactive_seats')
    op.drop_column('rooms', 'active_seats')
