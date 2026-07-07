"""Add conflict_dismissals table

Revision ID: j0e1f2g3h4i5
Revises: i9d0e1f2g3h4
Create Date: 2026-07-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'j0e1f2g3h4i5'
down_revision: Union[str, Sequence[str], None] = 'i9d0e1f2g3h4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'conflict_dismissals',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('conflict_type', sa.String(), nullable=False),
        sa.Column('item_a_id', sa.Integer(), nullable=False),
        sa.Column('item_b_id', sa.Integer(), nullable=True),
        sa.Column('reason', sa.String(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['item_a_id'], ['schedule_items.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['item_b_id'], ['schedule_items.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('conflict_type', 'item_a_id', 'item_b_id', name='uq_dismissal_signature'),
    )
    op.create_index(op.f('ix_conflict_dismissals_item_a_id'), 'conflict_dismissals', ['item_a_id'], unique=False)
    op.create_index(op.f('ix_conflict_dismissals_item_b_id'), 'conflict_dismissals', ['item_b_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_conflict_dismissals_item_b_id'), table_name='conflict_dismissals')
    op.drop_index(op.f('ix_conflict_dismissals_item_a_id'), table_name='conflict_dismissals')
    op.drop_table('conflict_dismissals')
