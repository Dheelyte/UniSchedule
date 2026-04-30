"""Add course-faculty enrollments

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'course_faculty_enrollments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=False),
        sa.Column('faculty_id', sa.String(), nullable=False),
        sa.Column('enrolled_by', sa.Integer(), nullable=True),
        sa.Column('enrolled_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['faculty_id'], ['faculties.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['enrolled_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('course_id', 'faculty_id', name='uq_enrollment_course_faculty'),
    )
    op.create_index('ix_course_faculty_enrollments_course_id', 'course_faculty_enrollments', ['course_id'])
    op.create_index('ix_course_faculty_enrollments_faculty_id', 'course_faculty_enrollments', ['faculty_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_course_faculty_enrollments_faculty_id', table_name='course_faculty_enrollments')
    op.drop_index('ix_course_faculty_enrollments_course_id', table_name='course_faculty_enrollments')
    op.drop_table('course_faculty_enrollments')
