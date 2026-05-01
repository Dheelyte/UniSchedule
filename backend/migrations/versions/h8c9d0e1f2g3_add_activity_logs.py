"""Add activity_logs table

Revision ID: h8c9d0e1f2g3
Revises: g7b8c9d0e1f2
Create Date: 2026-05-01 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'h8c9d0e1f2g3'
down_revision: Union[str, Sequence[str], None] = 'g7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'activity_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('user_email', sa.String(), nullable=True),
        sa.Column('user_role', sa.String(), nullable=True),
        sa.Column('user_faculty_id', sa.String(), nullable=True),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=True),
        sa.Column('entity_id', sa.String(), nullable=True),
        sa.Column('description', sa.String(), nullable=False),
        sa.Column('extra', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_activity_logs_created_at', 'activity_logs', ['created_at'])
    op.create_index('ix_activity_logs_action', 'activity_logs', ['action'])
    op.create_index('ix_activity_logs_entity', 'activity_logs', ['entity_type', 'entity_id'])


def downgrade() -> None:
    op.drop_index('ix_activity_logs_entity', table_name='activity_logs')
    op.drop_index('ix_activity_logs_action', table_name='activity_logs')
    op.drop_index('ix_activity_logs_created_at', table_name='activity_logs')
    op.drop_table('activity_logs')
