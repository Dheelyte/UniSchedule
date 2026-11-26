"""Let an import be approved, after which it can no longer be reverted

Revision ID: ap01b2c3d4e5
Revises: hd01a7c4e9b2
Create Date: 2026-11-26 00:00:00.000000

Adds three nullable columns to timetable_imports. Existing imports stay
unapproved (NULL), so they can still be reverted. The previous version of the
code never reads these columns, so it keeps working while this is applied.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'ap01b2c3d4e5'
down_revision: Union[str, Sequence[str], None] = 'hd01a7c4e9b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('timetable_imports', sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('timetable_imports', sa.Column('approved_by', sa.Integer(), nullable=True))
    op.add_column('timetable_imports', sa.Column('approved_by_email', sa.String(), nullable=True))
    op.create_foreign_key(
        'fk_timetable_imports_approved_by_users', 'timetable_imports', 'users',
        ['approved_by'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_timetable_imports_approved_by_users', 'timetable_imports', type_='foreignkey')
    op.drop_column('timetable_imports', 'approved_by_email')
    op.drop_column('timetable_imports', 'approved_by')
    op.drop_column('timetable_imports', 'approved_at')
