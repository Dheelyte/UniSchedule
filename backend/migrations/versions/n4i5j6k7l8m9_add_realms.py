"""Add realms and realm_key columns

Revision ID: n4i5j6k7l8m9
Revises: m3h4i5j6k7l8
Create Date: 2026-10-08 00:00:00.000000

Additive and safe for the previous version of the code: the deploy workflow
runs this on production before the new Lambda is live, so old code keeps
inserting rows without realm_key and the 'UG' server defaults place them in UG.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'n4i5j6k7l8m9'
down_revision: Union[str, Sequence[str], None] = 'm3h4i5j6k7l8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Kept as literals on purpose (a migration must not import app code).
# tests/test_realms.py checks they match modules/realms/defaults.py.
UG_CONFIG = {
    "lecture_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    "exam_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    "day_start": "08:00",
    "day_end": "18:00",
    "slot_minutes": 30,
    "exam_slots": [
        {"label": "9am - 12pm", "start": "09:00", "end": "12:00"},
        {"label": "12pm - 3pm", "start": "12:00", "end": "15:00"},
        {"label": "3pm - 6pm", "start": "15:00", "end": "18:00"},
    ],
    "levels": [100, 200, 300, 400, 500, 600, 700],
    "semester_names": ["First Semester", "Second Semester"],
    "strict": False,
}

ICE_CONFIG = {
    "lecture_days": ["Friday", "Saturday", "Sunday"],
    "exam_days": ["Friday", "Saturday", "Sunday"],
    "day_start": "07:00",
    "day_end": "21:00",
    "slot_minutes": 15,
    "exam_slots": [
        {"label": "7am - 10am", "start": "07:00", "end": "10:00"},
        {"label": "10am - 1pm", "start": "10:00", "end": "13:00"},
        {"label": "1pm - 4pm", "start": "13:00", "end": "16:00"},
        {"label": "4pm - 7pm", "start": "16:00", "end": "19:00"},
        {"label": "7pm - 9pm", "start": "19:00", "end": "21:00"},
    ],
    "levels": [100, 200, 300, 400, 500, 600, 700],
    "semester_names": ["First Semester", "Second Semester"],
    "strict": True,
}

# Realm is required on these; the server default fills existing rows with UG.
REQUIRED_TABLES = ("academic_sessions", "courses", "schedule_items", "change_requests")
# NULL means a cross-realm account.
ACCOUNT_TABLES = ("users", "invitations")
CROSS_REALM_ROLES = "('SUPER_ADMIN', 'SUPER_VIEWER', 'CITS_ADMIN')"


def upgrade() -> None:
    """Upgrade schema."""
    # 1. Realms and their seed rows.
    realms = op.create_table(
        'realms',
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('is_live', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
        sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('key'),
    )
    op.bulk_insert(realms, [
        {"key": "UG", "name": "Undergraduate", "description": "Full-time undergraduate programmes",
         "is_live": True, "sort_order": 1, "config": UG_CONFIG},
        {"key": "PG", "name": "Postgraduate", "description": "Postgraduate programmes",
         "is_live": False, "sort_order": 2, "config": UG_CONFIG},
        {"key": "ICE", "name": "ICE", "description": "Part-time programmes",
         "is_live": False, "sort_order": 3, "config": ICE_CONFIG},
        {"key": "FOUNDATION", "name": "Foundation", "description": "Foundation programmes",
         "is_live": False, "sort_order": 4, "config": UG_CONFIG},
    ])

    # 2. realm_key columns.
    for table in REQUIRED_TABLES:
        op.add_column(table, sa.Column(
            'realm_key', sa.String(), sa.ForeignKey('realms.key'), server_default='UG', nullable=False,
        ))
    for table in ACCOUNT_TABLES:
        op.add_column(table, sa.Column(
            'realm_key', sa.String(), sa.ForeignKey('realms.key'), server_default='UG', nullable=True,
        ))
    op.add_column('activity_logs', sa.Column('realm_key', sa.String(), nullable=True))

    # 3. Cross-realm accounts have no realm; existing audit rows are UG's.
    # The ::text cast avoids "unsafe use of new value of enum type" when this
    # runs in the same transaction as the revisions that added those roles.
    op.execute(f"UPDATE users SET realm_key = NULL WHERE role::text IN {CROSS_REALM_ROLES}")
    op.execute(f"UPDATE invitations SET realm_key = NULL WHERE target_role::text IN {CROSS_REALM_ROLES}")
    op.execute("UPDATE activity_logs SET realm_key = 'UG'")

    # 4. Course codes are unique per realm, not globally.
    op.drop_index(op.f('ix_courses_code'), table_name='courses')
    op.create_index(op.f('ix_courses_code'), 'courses', ['code'], unique=False)
    op.create_unique_constraint('uq_courses_realm_code', 'courses', ['realm_key', 'code'])

    # 5. Indexes.
    for table in (*REQUIRED_TABLES, *ACCOUNT_TABLES, 'activity_logs'):
        op.create_index(op.f(f'ix_{table}_realm_key'), table, ['realm_key'], unique=False)

    # 6. At most one current session and one current semester per realm.
    op.execute("""
        UPDATE academic_sessions s SET is_current = false
        WHERE s.is_current AND s.id <> (
            SELECT max(x.id) FROM academic_sessions x
            WHERE x.is_current AND x.realm_key = s.realm_key
        )
    """)
    # Prefer a current semester of the realm's current session, then the highest id.
    op.execute("""
        WITH ranked AS (
            SELECT sem.id, row_number() OVER (
                PARTITION BY sess.realm_key ORDER BY sess.is_current DESC, sem.id DESC
            ) AS rn
            FROM semesters sem JOIN academic_sessions sess ON sess.id = sem.session_id
            WHERE sem.is_current
        )
        UPDATE semesters SET is_current = false
        WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    """)
    op.create_index(
        'uq_academic_sessions_one_current', 'academic_sessions', ['realm_key'],
        unique=True, postgresql_where=sa.text('is_current'),
    )


def downgrade() -> None:
    """Downgrade schema.

    The is_current flags cleared by the upgrade are not restored.
    """
    # 7. The old unique index on courses.code can't hold a code used by two realms.
    duplicates = op.get_bind().execute(sa.text(
        "SELECT code FROM courses GROUP BY code HAVING count(*) > 1 ORDER BY code LIMIT 10"
    )).scalars().all()
    if duplicates:
        raise RuntimeError(
            "Cannot downgrade: these course codes exist in more than one realm: "
            f"{', '.join(duplicates)}. Remove or rename the duplicates first."
        )

    op.drop_index('uq_academic_sessions_one_current', table_name='academic_sessions')
    for table in (*REQUIRED_TABLES, *ACCOUNT_TABLES, 'activity_logs'):
        op.drop_index(op.f(f'ix_{table}_realm_key'), table_name=table)

    op.drop_constraint('uq_courses_realm_code', 'courses', type_='unique')
    op.drop_index(op.f('ix_courses_code'), table_name='courses')
    op.create_index(op.f('ix_courses_code'), 'courses', ['code'], unique=True)

    for table in (*REQUIRED_TABLES, *ACCOUNT_TABLES, 'activity_logs'):
        op.drop_column(table, 'realm_key')
    op.drop_table('realms')
