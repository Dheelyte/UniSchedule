"""Signatures, stamps and verification codes for FINAL timetables

Revision ID: r8m9n0o1p2q3
Revises: q7l8m9n0o1p2
Create Date: 2026-11-07 00:00:00.000000

Adds two new tables and touches nothing else, so the previous version of the
code keeps working while this is applied.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'r8m9n0o1p2q3'
down_revision: Union[str, Sequence[str], None] = 'q7l8m9n0o1p2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'timetable_signoffs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('realm_key', sa.String(), sa.ForeignKey('realms.key'), nullable=False),
        sa.Column('timetable_type', sa.String(), nullable=False),
        sa.Column('signatory_name', sa.String(), server_default='', nullable=False),
        sa.Column('signatory_title', sa.String(), server_default='Vice-Chancellor', nullable=False),
        sa.Column('signature_image', sa.Text(), nullable=True),
        sa.Column('stamp_image', sa.Text(), nullable=True),
        sa.Column('updated_by', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('realm_key', 'timetable_type', name='uq_signoff_realm_type'),
    )
    op.create_index('ix_timetable_signoffs_realm_key', 'timetable_signoffs', ['realm_key'])

    op.create_table(
        'timetable_verifications',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(), nullable=False),
        sa.Column('realm_key', sa.String(), sa.ForeignKey('realms.key'), nullable=False),
        sa.Column('semester_id', sa.Integer(), sa.ForeignKey('semesters.id', ondelete='CASCADE'), nullable=False),
        sa.Column('timetable_type', sa.String(), nullable=False),
        sa.Column('locked_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('locked_by_email', sa.String(), nullable=True),
        sa.Column('reopened_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_timetable_verifications_code', 'timetable_verifications', ['code'], unique=True)
    op.create_index('ix_timetable_verifications_realm_key', 'timetable_verifications', ['realm_key'])
    op.create_index('ix_timetable_verifications_semester_id', 'timetable_verifications', ['semester_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_timetable_verifications_semester_id', table_name='timetable_verifications')
    op.drop_index('ix_timetable_verifications_realm_key', table_name='timetable_verifications')
    op.drop_index('ix_timetable_verifications_code', table_name='timetable_verifications')
    op.drop_table('timetable_verifications')
    op.drop_index('ix_timetable_signoffs_realm_key', table_name='timetable_signoffs')
    op.drop_table('timetable_signoffs')
