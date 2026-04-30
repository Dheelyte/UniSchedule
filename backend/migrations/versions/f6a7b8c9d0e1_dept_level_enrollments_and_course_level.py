"""Audience-aware enrollments: drop old course_faculty_enrollments, add courses.level + course_enrollments

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-04-27 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('courses', sa.Column('level', sa.Integer(), nullable=True))

    op.drop_index('ix_course_faculty_enrollments_faculty_id', table_name='course_faculty_enrollments')
    op.drop_index('ix_course_faculty_enrollments_course_id', table_name='course_faculty_enrollments')
    op.drop_table('course_faculty_enrollments')

    op.create_table(
        'course_enrollments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('level', sa.Integer(), nullable=False),
        sa.Column('enrolled_by', sa.Integer(), nullable=True),
        sa.Column('enrolled_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['enrolled_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('course_id', 'department_id', 'level', name='uq_enrollment_course_dept_level'),
    )
    op.create_index('ix_course_enrollments_course_id', 'course_enrollments', ['course_id'])
    op.create_index('ix_course_enrollments_department_id', 'course_enrollments', ['department_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_course_enrollments_department_id', table_name='course_enrollments')
    op.drop_index('ix_course_enrollments_course_id', table_name='course_enrollments')
    op.drop_table('course_enrollments')

    op.create_table(
        'course_faculty_enrollments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=False),
        sa.Column('faculty_id', sa.String(), nullable=False),
        sa.Column('enrolled_by', sa.Integer(), nullable=True),
        sa.Column('enrolled_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['faculty_id'], ['faculties.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['enrolled_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('course_id', 'faculty_id', name='uq_enrollment_course_faculty'),
    )
    op.create_index('ix_course_faculty_enrollments_course_id', 'course_faculty_enrollments', ['course_id'])
    op.create_index('ix_course_faculty_enrollments_faculty_id', 'course_faculty_enrollments', ['faculty_id'])

    op.drop_column('courses', 'level')
