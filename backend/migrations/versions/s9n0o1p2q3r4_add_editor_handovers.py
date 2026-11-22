"""Faculty Editors handing their editor access to a Faculty Viewer

Revision ID: s9n0o1p2q3r4
Revises: r8m9n0o1p2q3
Create Date: 2026-11-22 00:00:00.000000

Adds one new table and touches nothing else, so the previous version of the
code keeps working while this is applied.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 's9n0o1p2q3r4'
down_revision: Union[str, Sequence[str], None] = 'r8m9n0o1p2q3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'editor_handovers',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('realm_key', sa.String(), sa.ForeignKey('realms.key'), nullable=False),
        sa.Column('faculty_id', sa.String(), nullable=False),
        sa.Column('granted_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('holder_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('granted_by_email', sa.String(), nullable=False),
        sa.Column('holder_email', sa.String(), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('end_reason', sa.String(), nullable=True),
        sa.Column('ended_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index('ix_editor_handovers_realm_key', 'editor_handovers', ['realm_key'])
    op.create_index('ix_editor_handovers_faculty_id', 'editor_handovers', ['faculty_id'])
    op.create_index(
        'uq_editor_handovers_active_granted_by', 'editor_handovers', ['granted_by_id'],
        unique=True, postgresql_where=sa.text('ended_at IS NULL'),
    )
    op.create_index(
        'uq_editor_handovers_active_holder', 'editor_handovers', ['holder_id'],
        unique=True, postgresql_where=sa.text('ended_at IS NULL'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('uq_editor_handovers_active_holder', table_name='editor_handovers')
    op.drop_index('uq_editor_handovers_active_granted_by', table_name='editor_handovers')
    op.drop_index('ix_editor_handovers_faculty_id', table_name='editor_handovers')
    op.drop_index('ix_editor_handovers_realm_key', table_name='editor_handovers')
    op.drop_table('editor_handovers')
