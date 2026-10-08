"""The realms revision: reversible, and it backfills UG-era data (ICE realm phase 1).

Alembic runs as a subprocess against its own scratch database, so downgrades
never touch the database the rest of the suite uses.
"""
import os
import subprocess
import sys

import asyncpg
import pytest

from tests.conftest import BACKEND_DIR, TEST_DATABASE_URL, _url

# Each test runs Alembic several times in a subprocess. Quick runs can skip them
# with -m "not slow"; a phase's final check runs everything.
pytestmark = pytest.mark.slow

PREVIOUS_HEAD = "m3h4i5j6k7l8"
REALMS_REVISION = "n4i5j6k7l8m9"
SCRATCH_DB = "unilag_timetable_migration_test"
# conftest has already refused any TEST_DATABASE_URL that isn't a local *_test database.
SCRATCH_URL = _url.set(database=SCRATCH_DB).render_as_string(hide_password=False)
REALM_TABLES = (
    "academic_sessions", "courses", "schedule_items", "change_requests",
    "users", "invitations", "activity_logs",
)


def _alembic(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": SCRATCH_URL},
        capture_output=True,
        text=True,
    )
    if check:
        assert result.returncode == 0, result.stdout + result.stderr
    return result


async def _connect(database: str) -> asyncpg.Connection:
    return await asyncpg.connect(
        host=_url.host, port=_url.port or 5432, user=_url.username, password=_url.password, database=database,
    )


@pytest.fixture
async def scratch():
    """A connection to an empty scratch database, dropped again afterwards."""
    assert SCRATCH_URL != TEST_DATABASE_URL
    admin = await _connect("postgres")
    await admin.execute(f'DROP DATABASE IF EXISTS "{SCRATCH_DB}" WITH (FORCE)')
    await admin.execute(f'CREATE DATABASE "{SCRATCH_DB}"')
    conn = await _connect(SCRATCH_DB)
    try:
        yield conn
    finally:
        await conn.close()
        await admin.execute(f'DROP DATABASE IF EXISTS "{SCRATCH_DB}" WITH (FORCE)')
        await admin.close()


async def _realm_columns(conn) -> set[str]:
    rows = await conn.fetch(
        "SELECT table_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND column_name = 'realm_key'"
    )
    return {row["table_name"] for row in rows}


async def _courses_code_index(conn) -> str:
    return await conn.fetchval("SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_courses_code'")


async def test_upgrade_downgrade_upgrade(scratch):
    _alembic("upgrade", "head")
    assert await _realm_columns(scratch) == set(REALM_TABLES)
    assert await scratch.fetchval("SELECT count(*) FROM realms") == 4
    assert "UNIQUE" not in await _courses_code_index(scratch)
    # The models and the hand-written revision agree: autogenerate finds nothing to add.
    _alembic("check")

    # A code shared by two realms can't go back under the old unique index.
    await scratch.execute(
        "INSERT INTO courses (code, title, credit_load, lecturers, scope, is_cbt_exam, realm_key) VALUES "
        "('GST101', 'A', 2, '{}', 'DEPARTMENTAL', false, 'UG'), ('GST101', 'A', 2, '{}', 'DEPARTMENTAL', false, 'ICE')"
    )
    failed = _alembic("downgrade", PREVIOUS_HEAD, check=False)
    assert failed.returncode != 0
    assert "more than one realm: GST101" in failed.stderr
    assert await scratch.fetchval("SELECT version_num FROM alembic_version") == REALMS_REVISION
    await scratch.execute("DELETE FROM courses")

    _alembic("downgrade", PREVIOUS_HEAD)
    assert await _realm_columns(scratch) == set()
    assert await scratch.fetchval("SELECT to_regclass('public.realms')") is None
    assert "UNIQUE" in await _courses_code_index(scratch)

    _alembic("upgrade", "head")
    assert await _realm_columns(scratch) == set(REALM_TABLES)
    assert await scratch.fetchval("SELECT count(*) FROM realms") == 4


async def test_legacy_rows_are_backfilled_to_ug(scratch):
    _alembic("upgrade", PREVIOUS_HEAD)
    await scratch.execute("""
        INSERT INTO academic_sessions (name, is_current) VALUES
            ('2024/2025', true), ('2025/2026', true);
        INSERT INTO semesters (name, is_current, session_id) VALUES
            ('Second Semester', true, 1), ('First Semester', true, 2), ('Second Semester', true, 2);
        INSERT INTO courses (code, title, credit_load, lecturers, scope, is_cbt_exam) VALUES
            ('CEG201', 'Mechanics', 3, '{}', 'DEPARTMENTAL', false);
        INSERT INTO schedule_items (course_id, room_ids, day_of_week, start_time, end_time, type, semester_id) VALUES
            (1, '{}', 'Monday', '10:00', '12:00', 'lecture', 3);
        INSERT INTO change_requests (semester_id, timetable_type, action) VALUES (3, 'lecture', 'ADD');
        INSERT INTO users (email, hashed_password, role, is_active) VALUES
            ('admin@example.com', 'x', 'SUPER_ADMIN', true),
            ('viewer@example.com', 'x', 'SUPER_VIEWER', true),
            ('cits@example.com', 'x', 'CITS_ADMIN', true),
            ('editor@example.com', 'x', 'FACULTY_EDITOR', true),
            ('fviewer@example.com', 'x', 'FACULTY_VIEWER', true),
            ('gs@example.com', 'x', 'GS_ADMIN', true);
        INSERT INTO invitations (email, token, target_role, expires_at, is_used) VALUES
            ('new-admin@example.com', 't1', 'SUPER_ADMIN', now(), false),
            ('new-editor@example.com', 't2', 'FACULTY_EDITOR', now(), false);
        INSERT INTO activity_logs (action, description) VALUES ('course.create', 'Created CEG201');
    """)

    _alembic("upgrade", "head")

    for table in ("academic_sessions", "courses", "schedule_items", "change_requests", "activity_logs"):
        keys = [row["realm_key"] for row in await scratch.fetch(f"SELECT realm_key FROM {table}")]
        assert keys and set(keys) == {"UG"}, table

    users = dict(await scratch.fetch("SELECT email, realm_key FROM users"))
    assert users == {
        "admin@example.com": None,
        "viewer@example.com": None,
        "cits@example.com": None,
        "editor@example.com": "UG",
        "fviewer@example.com": "UG",
        "gs@example.com": "UG",
    }
    invitations = dict(await scratch.fetch("SELECT email, realm_key FROM invitations"))
    assert invitations == {"new-admin@example.com": None, "new-editor@example.com": "UG"}

    # One current session and one current semester survive: the newest of each.
    current_sessions = await scratch.fetch("SELECT id FROM academic_sessions WHERE is_current")
    assert [row["id"] for row in current_sessions] == [2]
    current_semesters = await scratch.fetch("SELECT id FROM semesters WHERE is_current")
    assert [row["id"] for row in current_semesters] == [3]

    # Rows written by the previous version of the code (no realm_key) still land in UG.
    await scratch.execute("""
        INSERT INTO courses (code, title, credit_load, lecturers, scope, is_cbt_exam)
            VALUES ('CEG202', 'Statics', 3, '{}', 'DEPARTMENTAL', false);
        INSERT INTO users (email, hashed_password, role, is_active) VALUES ('late@example.com', 'x', 'FACULTY_EDITOR', true);
    """)
    assert await scratch.fetchval("SELECT realm_key FROM courses WHERE code = 'CEG202'") == "UG"
    assert await scratch.fetchval("SELECT realm_key FROM users WHERE email = 'late@example.com'") == "UG"

    # A second current session in the same realm is refused; another realm may have its own.
    with pytest.raises(asyncpg.UniqueViolationError, match="uq_academic_sessions_one_current"):
        await scratch.execute("INSERT INTO academic_sessions (name, is_current) VALUES ('2026/2027', true)")
    await scratch.execute("INSERT INTO academic_sessions (name, is_current, realm_key) VALUES ('2026/2027', true, 'ICE')")
