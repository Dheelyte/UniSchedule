"""Add GS_ADMIN role and make schedule_items.faculty_id nullable

Revision ID: c7d8e9f0a1b2
Revises: b8c0f3aa7bf2
Create Date: 2026-04-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, Sequence[str], None] = 'b8c0f3aa7bf2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE roleenum ADD VALUE IF NOT EXISTS 'GS_ADMIN'")
    op.alter_column('schedule_items', 'faculty_id', existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    op.alter_column('schedule_items', 'faculty_id', existing_type=sa.String(), nullable=False)
