"""The realm revisions: reversible, and they keep existing data in UG.

The first adds realms (ICE realm phase 1). The second gives each realm its own
faculties and rooms, and moves any data another realm entered while those were
shared onto faculties, departments and rooms of its own.

Alembic runs as a subprocess against its own scratch database, so downgrades
never touch the database the rest of the suite uses.
"""
import os
import subprocess
import sys

import asyncpg
import pytest

from tests.conftest import BACKEND_DIR, TEST_DATABASE_URL, _url
from tests.db_guard import assert_disposable_database

# Each test runs Alembic several times in a subprocess. Quick runs can skip them
# with -m "not slow"; a phase's final check runs everything.
pytestmark = pytest.mark.slow

PREVIOUS_HEAD = "2f166d445031"
REALMS_REVISION = "n4i5j6k7l8m9"
SEPARATION_REVISION = "o5j6k7l8m9n0"
SCRATCH_DB = "unilag_timetable_migration_test"
# conftest has already refused any TEST_DATABASE_URL that isn't a local *_test database.
SCRATCH_URL = _url.set(database=SCRATCH_DB).render_as_string(hide_password=False)
REALM_TABLES = (
    "academic_sessions", "courses", "schedule_items", "change_requests",
    "users", "invitations", "activity_logs",
)
# Added by the separation revision.
SEPARATED_TABLES = ("faculties", "rooms")


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
    # This fixture drops the database, before and after the test.
    assert_disposable_database(SCRATCH_URL)
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
    assert await _realm_columns(scratch) == {*REALM_TABLES, *SEPARATED_TABLES}
    assert await scratch.fetchval("SELECT count(*) FROM realms") == 4
    assert "UNIQUE" not in await _courses_code_index(scratch)
    # The models and the hand-written revisions agree: autogenerate finds nothing to add.
    _alembic("check")

    # Back over the separation revision first; the rest is about the realms revision.
    _alembic("downgrade", REALMS_REVISION)
    assert await _realm_columns(scratch) == set(REALM_TABLES)
    assert await scratch.fetchval("SELECT to_regclass('public.hall_groups')") is None

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
    assert await _realm_columns(scratch) == {*REALM_TABLES, *SEPARATED_TABLES}
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


# --- Separate faculties and rooms ----------------------------------------------

UG_ERA_ORG = """
    INSERT INTO faculties (id, name, is_special) VALUES
        ('ENG', 'Engineering', false), ('SCI', 'Science', true), ('LAW', 'Law', false);
    INSERT INTO departments (name, faculty_id) VALUES ('Civil', 'ENG'), ('Physics', 'SCI'), ('Private Law', 'LAW');
    INSERT INTO rooms (name, capacity, faculty_id, display_order, is_lab, is_active, active_seats, inactive_seats) VALUES
        ('ENG 101', 100, 'ENG', 3, true, true, 90, 10),
        ('Hall', 500, NULL, 1, false, true, 500, 0),
        ('LAW 1', 60, 'LAW', 2, false, false, 60, 0),
        -- Allowed today: one name under two faculties, and twice with no faculty.
        ('ENG 101', 40, 'SCI', 0, false, true, 40, 0),
        ('Hall', 80, NULL, 0, false, true, 80, 0);
"""


async def _rows(conn, query: str) -> list[tuple]:
    return [tuple(row.values()) for row in await conn.fetch(query)]


async def test_existing_faculties_and_rooms_stay_in_ug_untouched(scratch):
    _alembic("upgrade", REALMS_REVISION)
    await scratch.execute(UG_ERA_ORG)
    faculties = await _rows(scratch, "SELECT id, name, is_special FROM faculties ORDER BY id")
    departments = await _rows(scratch, "SELECT id, name, faculty_id FROM departments ORDER BY id")
    rooms = await _rows(scratch, """
        SELECT id, name, capacity, faculty_id, display_order, is_lab, is_active, active_seats, inactive_seats
        FROM rooms ORDER BY id
    """)

    _alembic("upgrade", "head")

    # No id, name or value changed, nothing was added, and everything is UG's.
    assert await _rows(scratch, "SELECT id, name, is_special FROM faculties ORDER BY id") == faculties
    assert await _rows(scratch, "SELECT id, name, faculty_id FROM departments ORDER BY id") == departments
    assert await _rows(scratch, """
        SELECT id, name, capacity, faculty_id, display_order, is_lab, is_active, active_seats, inactive_seats
        FROM rooms ORDER BY id
    """) == rooms
    assert await _rows(scratch, "SELECT DISTINCT realm_key FROM faculties") == [("UG",)]
    assert await _rows(scratch, "SELECT DISTINCT realm_key, hall_group_id FROM rooms") == [("UG", None)]
    assert await scratch.fetchval("SELECT count(*) FROM hall_groups") == 0

    # Rows written by the previous version of the code (no realm_key) still land in UG.
    await scratch.execute("""
        INSERT INTO faculties (id, name, is_special) VALUES ('ART', 'Arts', false);
        INSERT INTO rooms (name, capacity, faculty_id) VALUES ('ART 1', 30, 'ART');
    """)
    assert await scratch.fetchval("SELECT realm_key FROM faculties WHERE id = 'ART'") == "UG"
    assert await scratch.fetchval("SELECT realm_key FROM rooms WHERE name = 'ART 1'") == "UG"

    # Names are unique inside a realm; another realm may reuse them.
    with pytest.raises(asyncpg.UniqueViolationError, match="uq_faculties_realm_name"):
        await scratch.execute("INSERT INTO faculties (id, name) VALUES ('ENG2', 'Engineering')")
    await scratch.execute("INSERT INTO faculties (id, name, realm_key) VALUES ('ICE-ENG', 'Engineering', 'ICE')")
    with pytest.raises(asyncpg.UniqueViolationError, match="uq_room_realm_name_faculty"):
        await scratch.execute("INSERT INTO rooms (name, capacity, faculty_id) VALUES ('LAW 1', 10, 'LAW')")
    await scratch.execute("INSERT INTO rooms (name, capacity, faculty_id, realm_key) VALUES ('ENG 101', 10, 'ICE-ENG', 'ICE')")

    # A hall group holds one room per realm.
    await scratch.execute("""
        INSERT INTO hall_groups DEFAULT VALUES;
        UPDATE rooms SET hall_group_id = 1 WHERE name = 'ENG 101' AND faculty_id IN ('ENG', 'ICE-ENG');
    """)
    with pytest.raises(asyncpg.UniqueViolationError, match="uq_room_hall_group_realm"):
        await scratch.execute("UPDATE rooms SET hall_group_id = 1 WHERE name = 'LAW 1'")

    # Other realms' faculties and rooms can't be folded back into one shared list.
    failed = _alembic("downgrade", REALMS_REVISION, check=False)
    assert failed.returncode != 0
    assert "ICE-ENG" in failed.stderr and "ENG 101" in failed.stderr
    assert await scratch.fetchval("SELECT version_num FROM alembic_version") == SEPARATION_REVISION
    await scratch.execute("DELETE FROM rooms WHERE realm_key = 'ICE'; DELETE FROM faculties WHERE realm_key = 'ICE'")

    _alembic("downgrade", REALMS_REVISION)
    assert await _realm_columns(scratch) == set(REALM_TABLES)
    with pytest.raises(asyncpg.UniqueViolationError, match="faculties_name_key"):
        await scratch.execute("INSERT INTO faculties (id, name, is_special) VALUES ('ENG2', 'Engineering', false)")
    with pytest.raises(asyncpg.UniqueViolationError, match="uq_room_name_faculty"):
        await scratch.execute("INSERT INTO rooms (name, capacity, faculty_id) VALUES ('LAW 1', 10, 'LAW')")
    _alembic("upgrade", "head")


async def test_data_another_realm_entered_while_shared_moves_onto_its_own(scratch):
    """ICE was set up between the two revisions, on UG's faculties, departments and rooms."""
    _alembic("upgrade", REALMS_REVISION)
    await scratch.execute(UG_ERA_ORG)
    await scratch.execute("""
        INSERT INTO academic_sessions (name, is_current, realm_key) VALUES ('UG 2025/2026', true, 'UG'), ('ICE 2025/2026', true, 'ICE');
        INSERT INTO semesters (name, is_current, session_id) VALUES ('First Semester', true, 1), ('First Semester', true, 2);
        INSERT INTO courses (code, title, credit_load, lecturers, scope, is_cbt_exam, department_id, realm_key) VALUES
            ('CEG201', 'UG Mechanics', 3, '{}', 'DEPARTMENTAL', false, 1, 'UG'),
            ('CEG201', 'ICE Mechanics', 3, '{}', 'DEPARTMENTAL', false, 1, 'ICE'),
            ('GST101', 'ICE Use of English', 2, '{}', 'UNIVERSITY_WIDE', false, NULL, 'ICE');
        INSERT INTO course_enrollments (course_id, department_id, level) VALUES (1, 2, 100), (2, 2, 100);
        INSERT INTO schedule_items (course_id, room_ids, faculty_id, day_of_week, start_time, end_time, type, semester_id, realm_key) VALUES
            (1, '{1,2}', 'ENG', 'Monday', '10:00', '12:00', 'lecture', 1, 'UG'),
            (2, '{1,2}', 'ENG', 'Friday', '10:00', '12:00', 'lecture', 2, 'ICE'),
            (3, '{999}', NULL, 'Sunday', '10:00', '12:00', 'lecture', 2, 'ICE');
        INSERT INTO change_requests (semester_id, timetable_type, action, room_ids, faculty_id, realm_key) VALUES
            (1, 'lecture', 'ADD', '{3}', 'LAW', 'UG'),
            (2, 'lecture', 'ADD', '{1}', 'ENG', 'ICE');
        INSERT INTO users (email, hashed_password, role, is_active, faculty_id, realm_key) VALUES
            ('admin@example.com', 'x', 'SUPER_ADMIN', true, NULL, NULL),
            ('ug-editor@example.com', 'x', 'FACULTY_EDITOR', true, 'ENG', 'UG'),
            ('ice-editor@example.com', 'x', 'FACULTY_EDITOR', true, 'ENG', 'ICE');
        INSERT INTO invitations (email, token, target_role, expires_at, is_used, faculty_id, realm_key) VALUES
            ('ice-viewer@example.com', 't1', 'FACULTY_VIEWER', now(), false, 'SCI', 'ICE');
    """)
    ug_rooms = await _rows(scratch, """
        SELECT id, name, capacity, faculty_id, display_order, is_lab, is_active, active_seats, inactive_seats
        FROM rooms ORDER BY id
    """)

    _alembic("upgrade", "head")

    # UG keeps every faculty, department and room it had, with the same ids and values.
    assert await _rows(scratch, "SELECT id, name, is_special FROM faculties WHERE realm_key = 'UG' ORDER BY id") == [
        ("ENG", "Engineering", False), ("LAW", "Law", False), ("SCI", "Science", True),
    ]
    assert await _rows(scratch, """
        SELECT d.id, d.name, d.faculty_id FROM departments d JOIN faculties f ON f.id = d.faculty_id
        WHERE f.realm_key = 'UG' ORDER BY d.id
    """) == [(1, "Civil", "ENG"), (2, "Physics", "SCI"), (3, "Private Law", "LAW")]
    assert await _rows(scratch, """
        SELECT id, name, capacity, faculty_id, display_order, is_lab, is_active, active_seats, inactive_seats
        FROM rooms WHERE realm_key = 'UG' ORDER BY id
    """) == ug_rooms
    assert await _rows(scratch, "SELECT room_ids, faculty_id FROM schedule_items WHERE realm_key = 'UG'") == [([1, 2], "ENG")]
    assert await _rows(scratch, "SELECT room_ids, faculty_id FROM change_requests WHERE realm_key = 'UG'") == [([3], "LAW")]
    assert await _rows(scratch, "SELECT department_id FROM courses WHERE realm_key = 'UG'") == [(1,)]
    assert await scratch.fetchval("SELECT department_id FROM course_enrollments WHERE course_id = 1") == 2
    assert await scratch.fetchval("SELECT faculty_id FROM users WHERE email = 'ug-editor@example.com'") == "ENG"

    # ICE has its own copy of the faculties it used (Law it never touched), under ids of its own.
    assert await _rows(scratch, "SELECT id, name, is_special FROM faculties WHERE realm_key = 'ICE' ORDER BY id") == [
        ("ICE-ENG", "Engineering", False), ("ICE-SCI", "Science", True),
    ]
    ice_departments = {
        name: (dept_id, faculty_id) for dept_id, name, faculty_id in await _rows(scratch, """
            SELECT d.id, d.name, d.faculty_id FROM departments d JOIN faculties f ON f.id = d.faculty_id
            WHERE f.realm_key = 'ICE'
        """)
    }
    assert {name: faculty for name, (_, faculty) in ice_departments.items()} == {"Civil": "ICE-ENG", "Physics": "ICE-SCI"}
    assert await _rows(scratch, "SELECT code, department_id FROM courses WHERE realm_key = 'ICE' ORDER BY code") == [
        ("CEG201", ice_departments["Civil"][0]), ("GST101", None),
    ]
    assert await scratch.fetchval("SELECT department_id FROM course_enrollments WHERE course_id = 2") == ice_departments["Physics"][0]
    assert await scratch.fetchval("SELECT faculty_id FROM users WHERE email = 'ice-editor@example.com'") == "ICE-ENG"
    assert await scratch.fetchval("SELECT faculty_id FROM invitations WHERE email = 'ice-viewer@example.com'") == "ICE-SCI"

    # ...and its own copy of the two rooms it scheduled, each in one hall group with its original.
    ice_rooms = {
        row["name"]: row for row in await scratch.fetch("SELECT * FROM rooms WHERE realm_key = 'ICE'")
    }
    assert set(ice_rooms) == {"ENG 101", "Hall"}
    copy = ice_rooms["ENG 101"]
    assert (copy["faculty_id"], copy["capacity"], copy["active_seats"], copy["inactive_seats"], copy["is_lab"], copy["display_order"]) == (
        "ICE-ENG", 100, 90, 10, True, 3,
    )
    assert ice_rooms["Hall"]["faculty_id"] is None
    groups = dict(await _rows(scratch, "SELECT id, hall_group_id FROM rooms WHERE realm_key = 'UG'"))
    assert copy["hall_group_id"] == groups[1] is not None
    assert ice_rooms["Hall"]["hall_group_id"] == groups[2] is not None
    assert groups[1] != groups[2] and (groups[3], groups[4], groups[5]) == (None, None, None)

    moved = [copy["id"], ice_rooms["Hall"]["id"]]
    assert await _rows(scratch, "SELECT room_ids, faculty_id FROM schedule_items WHERE realm_key = 'ICE' ORDER BY id") == [
        (moved, "ICE-ENG"),
        # A room id that matches no room is left as it was.
        ([999], None),
    ]
    assert await _rows(scratch, "SELECT room_ids, faculty_id FROM change_requests WHERE realm_key = 'ICE'") == [([copy["id"]], "ICE-ENG")]
