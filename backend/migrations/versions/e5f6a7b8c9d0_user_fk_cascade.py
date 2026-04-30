"""Cascade rules on FKs to users so account deletion doesn't 500

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-04-27 00:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # notifications.user_id -> CASCADE (notifications die with the user)
    op.drop_constraint('notifications_user_id_fkey', 'notifications', type_='foreignkey')
    op.create_foreign_key(
        'notifications_user_id_fkey', 'notifications', 'users',
        ['user_id'], ['id'], ondelete='CASCADE',
    )

    # timetable_locks.locked_by -> SET NULL (lock persists; lose audit trail)
    op.drop_constraint('timetable_locks_locked_by_fkey', 'timetable_locks', type_='foreignkey')
    op.create_foreign_key(
        'timetable_locks_locked_by_fkey', 'timetable_locks', 'users',
        ['locked_by'], ['id'], ondelete='SET NULL',
    )

    # course_faculty_enrollments.enrolled_by -> SET NULL (enrollment is the faculty's, not the user's)
    op.drop_constraint('course_faculty_enrollments_enrolled_by_fkey', 'course_faculty_enrollments', type_='foreignkey')
    op.create_foreign_key(
        'course_faculty_enrollments_enrolled_by_fkey', 'course_faculty_enrollments', 'users',
        ['enrolled_by'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('course_faculty_enrollments_enrolled_by_fkey', 'course_faculty_enrollments', type_='foreignkey')
    op.create_foreign_key(
        'course_faculty_enrollments_enrolled_by_fkey', 'course_faculty_enrollments', 'users',
        ['enrolled_by'], ['id'],
    )

    op.drop_constraint('timetable_locks_locked_by_fkey', 'timetable_locks', type_='foreignkey')
    op.create_foreign_key(
        'timetable_locks_locked_by_fkey', 'timetable_locks', 'users',
        ['locked_by'], ['id'],
    )

    op.drop_constraint('notifications_user_id_fkey', 'notifications', type_='foreignkey')
    op.create_foreign_key(
        'notifications_user_id_fkey', 'notifications', 'users',
        ['user_id'], ['id'],
    )
