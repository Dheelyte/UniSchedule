"""Remember each user's page previews: whether they're on, and which pages were seen

Revision ID: tp01c4e8a2b6
Revises: ap01b2c3d4e5
Create Date: 2026-11-27 00:00:00.000000

Adds two columns to users with server defaults (previews on, nothing seen yet),
so every existing account gets them. The previous version of the code never
reads these columns, so it keeps working while this is applied.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = 'tp01c4e8a2b6'
down_revision: Union[str, Sequence[str], None] = 'ap01b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('tours_enabled', sa.Boolean(), nullable=False, server_default=sa.text('true')))
    op.add_column('users', sa.Column(
        'tours_seen', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb"),
    ))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'tours_seen')
    op.drop_column('users', 'tours_enabled')
