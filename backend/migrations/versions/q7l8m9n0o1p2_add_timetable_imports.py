"""Record timetable imports and copies so they can be listed and reverted

Revision ID: q7l8m9n0o1p2
Revises: p6k7l8m9n0o1
Create Date: 2026-10-24 00:00:00.000000

Adds one new table and touches nothing else, so the previous version of the
code keeps working while this is applied.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'q7l8m9n0o1p2'
down_revision: Union[str, Sequence[str], None] = 'p6k7l8m9n0o1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'timetable_imports',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('realm_key', sa.String(), sa.ForeignKey('realms.key'), nullable=False),
        sa.Column('faculty_id', sa.String(), nullable=True),
        sa.Column('semester_id', sa.Integer(), sa.ForeignKey('semesters.id', ondelete='CASCADE'), nullable=False),
        sa.Column('item_type', sa.String(), nullable=False),
        sa.Column('mode', sa.String(), nullable=False),
        sa.Column('place_in_faculties', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('source_semester_id', sa.Integer(), sa.ForeignKey('semesters.id', ondelete='SET NULL'), nullable=True),
        sa.Column('file_name', sa.String(), nullable=True),
        sa.Column('sheet', sa.String(), nullable=True),
        sa.Column('created_ids', postgresql.ARRAY(sa.Integer()), server_default='{}', nullable=False),
        sa.Column('replaced', postgresql.JSONB(), server_default='[]', nullable=False),
        sa.Column('left_out', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_by_email', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('reverted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reverted_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reverted_by_email', sa.String(), nullable=True),
        sa.Column('restored_ids', postgresql.ARRAY(sa.Integer()), server_default='{}', nullable=False),
    )
    op.create_index('ix_timetable_imports_realm_key', 'timetable_imports', ['realm_key'])
    op.create_index('ix_timetable_imports_semester_id', 'timetable_imports', ['semester_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_timetable_imports_semester_id', table_name='timetable_imports')
    op.drop_index('ix_timetable_imports_realm_key', table_name='timetable_imports')
    op.drop_table('timetable_imports')
