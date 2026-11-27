"""The Activity Logs filters (modules/audit/filters.py), GET /audit/logs and GET /audit/logs/options."""
from datetime import date, datetime, time, timedelta, timezone

import pytest

from core.database import async_session_maker
from modules.audit import categories
from modules.audit.filters import (
    AuditFilters,
    day_bounds,
    earliest_export_start,
    lagos_today,
    parse_time_window,
    preset_dates,
)
from modules.audit.models import ActivityLog
from modules.auth.models import RoleEnum
from modules.calendar.models import AcademicSession, Semester
from modules.timetable.models import ChangeRequest, Course, Department, Faculty, ScheduleItem

API = "/api/v1"
LOGS = f"{API}/audit/logs"
OPTIONS = f"{API}/audit/logs/options"
# Lagos is UTC+01:00 all year.
WAT = timezone(timedelta(hours=1))


def lagos(year, month, day, hour=12, minute=0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=WAT)


async def add_logs(*rows: dict) -> list[int]:
    """Insert activity log entries directly (UG unless a row says otherwise); their ids in order."""
    async with async_session_maker() as session:
        entries = [
            ActivityLog(**{"realm_key": "UG", "description": row.get("action", "entry"), **row})
            for row in rows
        ]
        session.add_all(entries)
        await session.commit()
        return [entry.id for entry in entries]


async def add(*objects):
    """Insert rows and return them with their ids."""
    async with async_session_maker() as session:
        session.add_all(objects)
        await session.commit()
        for obj in objects:
            await session.refresh(obj)
    return objects


async def ids(client, **params) -> list[int]:
    response = await client.get(LOGS, params={"limit": 500, **params})
    assert response.status_code == 200, response.text
    return [row["id"] for row in response.json()]


def custom(first: str, last: str, **params) -> dict:
    return {"range": "custom", "from": first, "to": last, **params}


@pytest.fixture
async def admin(signed_in):
    client, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    return client


@pytest.fixture
async def campus():
    """Two UG faculties with a department each, a course, and the current session's semester."""
    sci, eng = await add(Faculty(id="SCI", name="Faculty of Science", realm_key="UG"), Faculty(id="ENG", name="Faculty of Engineering", realm_key="UG"))
    physics, civil = await add(Department(name="Physics", faculty_id="SCI"), Department(name="Civil", faculty_id="ENG"))
    (course,) = await add(Course(code="PHY101", title="Physics I", department_id=physics.id, realm_key="UG"))
    (session,) = await add(AcademicSession(name="2026/2027", realm_key="UG", is_current=True))
    (semester,) = await add(Semester(name="First Semester", session_id=session.id, is_current=True))
    return {"sci": sci, "eng": eng, "physics": physics, "civil": civil, "course": course, "session": session, "semester": semester}


# ---------- Pure helpers ----------

def test_presets_at_week_and_month_boundaries():
    sunday = date(2026, 11, 1)
    assert preset_dates("today", sunday) == (sunday, sunday)
    assert preset_dates("yesterday", sunday) == (date(2026, 10, 31), date(2026, 10, 31))
    # Weeks start on Monday, so a Sunday is the end of the week that began six days earlier.
    assert preset_dates("this_week", sunday) == (date(2026, 10, 26), sunday)
    assert preset_dates("this_month", sunday) == (sunday, sunday)
    # "Last N days" include today.
    assert preset_dates("last_7_days", sunday) == (date(2026, 10, 26), sunday)
    assert preset_dates("last_30_days", sunday) == (date(2026, 10, 3), sunday)

    monday = date(2026, 11, 2)
    assert preset_dates("this_week", monday) == (monday, monday)

    new_year = date(2027, 1, 1)
    assert preset_dates("yesterday", new_year) == (date(2026, 12, 31), date(2026, 12, 31))
    assert preset_dates("this_month", new_year) == (new_year, new_year)
    assert preset_dates("this_week", new_year) == (date(2026, 12, 28), new_year)

    assert preset_dates("session", sunday, session_start=date(2026, 9, 15)) == (date(2026, 9, 15), sunday)
    with pytest.raises(ValueError):
        preset_dates("session", sunday, session_start=None)
    assert preset_dates("all", sunday) is None


def test_lagos_days():
    # 23:30 UTC is already the next day in Lagos.
    assert lagos_today(datetime(2026, 11, 25, 23, 30, tzinfo=timezone.utc)) == date(2026, 11, 26)
    start, end = day_bounds(date(2026, 11, 26), date(2026, 11, 26))
    assert start == datetime(2026, 11, 25, 23, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 11, 26, 23, 0, tzinfo=timezone.utc)


def test_time_windows():
    assert parse_time_window("08:00-17:00") == (time(8), time(17))
    assert parse_time_window("22:00-06:00") == (time(22), time(6))
    assert parse_time_window(" 8:30 – 17:45 ") == (time(8, 30), time(17, 45))
    for bad in ("08:00-08:00", "24:00-01:00", "08:60-09:00", "8-17", "", "morning"):
        with pytest.raises(ValueError):
            parse_time_window(bad)


def test_twelve_months_back():
    assert earliest_export_start(date(2026, 11, 26)) == date(2025, 11, 27)
    assert earliest_export_start(date(2026, 3, 1)) == date(2025, 3, 2)
    # A leap day ends a range whose year-earlier date doesn't exist.
    assert earliest_export_start(date(2024, 2, 29)) == date(2023, 3, 1)


def test_categories_replace_their_children_and_count_once():
    assert categories.normalize(["auth", "schedule_item.lecture", "schedule_item"]) == ("schedule_item", "auth")
    assert categories.normalize(["schedule_item.exam", "schedule_item.lecture"]) == ("schedule_item.lecture", "schedule_item.exam")
    with pytest.raises(ValueError):
        categories.normalize(["nope"])
    assert categories.category_of("schedule_item.exam.create").key == "schedule_item.exam"
    assert categories.category_of("schedule_item.lecture.import_revert").key == "schedule_item.lecture"
    assert categories.category_of("conflict.dismiss.bulk").key == "conflict"
    assert categories.category_of("realm.update").key == "realm"
    assert categories.category_of("activity_log.export").key == "activity_log"
    assert categories.category_of("something.new").key == "other"


def test_filter_model_reads_the_page_query():
    filters = AuditFilters.model_validate({
        "range": "custom", "from": "2026-11-01", "to": "2026-11-03", "time": "22:00-06:00",
        "cat": ["auth,schedule_item.exam", "schedule_item"], "user": "A@Example.com,b@example.com",
        "role": ["HOD"], "faculty": "ALL", "dept": "", "q": "  locked  ",
    })
    assert filters.categories == ("schedule_item", "auth")
    assert filters.users == ("a@example.com", "b@example.com")
    assert filters.time_window == (time(22), time(6))
    assert filters.faculty is None and filters.department is None
    assert filters.q == "locked"


# ---------- GET /audit/logs ----------

@pytest.mark.parametrize("params, message", [
    ({"range": "today", "time": "08:00-17:00"}, "only be set on a custom range"),
    ({"range": "custom", "from": "2026-11-01"}, "needs both a start and an end"),
    (custom("2026-11-05", "2026-11-01"), "ends before it starts"),
    (custom("2026-11-01", "2026-11-05", time="08:00-08:00"), "different times"),
    (custom("2026-11-01", "2026-11-05", time="lunch"), "08:00-17:00"),
    ({"range": "today", "from": "2026-11-01", "to": "2026-11-02"}, "only used with a custom range"),
    ({"cat": "nope"}, "Unknown category"),
    ({"role": "KING"}, "Unknown role"),
    ({"type": "cbt"}, "Invalid type"),
    ({"range": "forever"}, "Invalid range"),
    ({"action": "DROP TABLE"}, "Unknown action"),
])
async def test_bad_filters_are_refused_with_a_reason(admin, params, message):
    response = await admin.get(LOGS, params=params)
    assert response.status_code == 422, response.text
    assert message in response.json()["detail"]


async def test_timeframe_portal_and_no_cap_on_the_page(admin):
    old, inside, edge, after, ice, cross = await add_logs(
        {"action": "course.create", "created_at": lagos(2024, 1, 10)},
        {"action": "course.create", "created_at": lagos(2025, 11, 10)},
        # The last minute of the range's last Lagos day.
        {"action": "course.update", "created_at": lagos(2025, 11, 12, 23, 59)},
        # Midnight in Lagos is already the next day.
        {"action": "course.update", "created_at": lagos(2025, 11, 13, 0, 0)},
        {"action": "course.create", "created_at": lagos(2025, 11, 10), "realm_key": "ICE"},
        {"action": "auth.switch_realm", "created_at": lagos(2025, 11, 11), "realm_key": None},
    )
    window = custom("2025-11-10", "2025-11-12")
    assert set(await ids(admin, **window)) == {inside, edge, cross}
    assert set(await ids(admin, **window, portal="this")) == {inside, edge}
    assert set(await ids(admin, **window, portal="cross")) == {cross}
    # All time on the page: the 12-month cap is for exports only.
    everything = set(await ids(admin, range="all"))
    assert {old, inside, edge, after, cross} <= everything and ice not in everything
    assert set(await ids(admin, **custom("2020-01-01", "2026-12-31"))) >= {old, inside, edge, after, cross}
    # The page's default (no range at all) is every entry too.
    assert set(await ids(admin)) == everything


async def test_today_and_yesterday_presets(admin):
    # Signing in wrote an auth.login entry just now.
    today_ids = await ids(admin, range="today", cat="auth")
    assert len(today_ids) == 1
    assert await ids(admin, range="yesterday", cat="auth") == []
    assert today_ids == await ids(admin, range="last_7_days", cat="auth") == await ids(admin, range="this_month", cat="auth")


async def test_time_of_day_window_crossing_midnight(admin):
    rows = {
        "10th 00:30": lagos(2025, 11, 10, 0, 30),
        "10th 21:59": lagos(2025, 11, 10, 21, 59),
        "10th 22:00": lagos(2025, 11, 10, 22, 0),
        "10th 23:30": lagos(2025, 11, 10, 23, 30),
        "11th 00:30": lagos(2025, 11, 11, 0, 30),
        "11th 05:59": lagos(2025, 11, 11, 5, 59),
        "11th 06:00": lagos(2025, 11, 11, 6, 0),
        "11th 12:00": lagos(2025, 11, 11, 12, 0),
        # Outside the dates: each entry is judged by its own Lagos date.
        "12th 00:30": lagos(2025, 11, 12, 0, 30),
    }
    created = dict(zip(rows, await add_logs(*({"action": "course.update", "created_at": at} for at in rows.values()))))
    night = await ids(admin, **custom("2025-11-10", "2025-11-11", time="22:00-06:00"))
    assert {name for name, id_ in created.items() if id_ in night} == {
        "10th 00:30", "10th 22:00", "10th 23:30", "11th 00:30", "11th 05:59",
    }


async def test_time_of_day_window_within_a_day(admin):
    rows = [lagos(2025, 11, 10, 7, 59), lagos(2025, 11, 10, 8, 0), lagos(2025, 11, 10, 16, 59), lagos(2025, 11, 10, 17, 0)]
    _early, start, late, _end = await add_logs(*({"action": "course.update", "created_at": at} for at in rows))
    # The start is included and the end is not.
    assert set(await ids(admin, **custom("2025-11-10", "2025-11-10", time="08:00-17:00"))) == {start, late}


async def test_timetable_type_applies_across_every_related_category(admin, campus):
    sem, course = campus["semester"], campus["course"]
    lecture_item, exam_item = await add(
        ScheduleItem(course_id=course.id, type="lecture", day_of_week="Monday", start_time=time(10), end_time=time(12), realm_key="UG", semester_id=sem.id),
        ScheduleItem(course_id=course.id, type="exam", exam_date=date(2025, 12, 1), start_time=time(9), end_time=time(12), realm_key="UG", semester_id=sem.id),
    )
    (exam_request,) = await add(ChangeRequest(semester_id=sem.id, realm_key="UG", timetable_type="exam", action="ADD", course_id=course.id))
    at = lagos(2025, 11, 10)
    gone_request, gone_item, dismissal, slot = 99001, 99002, 99003, 99004

    expected = {
        # The action code.
        "schedule_item.lecture.create": ("lecture", {"action": "schedule_item.lecture.create", "entity_type": "schedule_item", "entity_id": str(lecture_item.id)}),
        "schedule_item.exam.import": ("exam", {"action": "schedule_item.exam.import", "entity_type": "timetable_import", "entity_id": "5"}),
        "schedule_item.lecture.import_revert": ("lecture", {"action": "schedule_item.lecture.import_revert", "entity_type": "timetable_import", "entity_id": "5"}),
        "schedule_item.exam.import_approve": ("exam", {"action": "schedule_item.exam.import_approve", "entity_type": "timetable_import", "entity_id": "6"}),
        "timetable.exam.shift": ("exam", {"action": "timetable.exam.shift", "entity_type": "semester", "entity_id": str(sem.id), "extra": {"request": {}, "moves": []}}),
        # extra.timetable_type.
        "timetable.lock": ("lecture", {"action": "timetable.lock", "entity_type": "timetable_lock", "entity_id": f"{sem.id}:lecture", "extra": {"timetable_type": "lecture", "is_locked": True}}),
        "timetable.unlock": ("exam", {"action": "timetable.unlock", "entity_type": "timetable_lock", "entity_id": f"{sem.id}:exam", "extra": {"timetable_type": "exam", "is_locked": False}}),
        "timetable.signoff.update": ("exam", {"action": "timetable.signoff.update", "entity_type": "timetable_signoff", "entity_id": "UG:exam", "extra": {"timetable_type": "exam", "changed": []}}),
        "change_request.create": ("lecture", {"action": "change_request.create", "entity_type": "change_request", "entity_id": str(gone_request), "extra": {"timetable_type": "lecture", "action": "ADD"}}),
        # entity_id "<semester>:<type>".
        "timetable.edit_request": ("exam", {"action": "timetable.edit_request", "entity_type": "timetable_lock", "entity_id": f"{sem.id}:exam", "extra": {"reason": "typo"}}),
        # The change request's row ...
        "change_request.approve (row)": ("exam", {"action": "change_request.approve", "entity_type": "change_request", "entity_id": str(exam_request.id), "extra": {"note": None}}),
        # ... or, once it's gone, its create entry above.
        "change_request.reject (create entry)": ("lecture", {"action": "change_request.reject", "entity_type": "change_request", "entity_id": str(gone_request), "extra": {"note": "no"}}),
        # extra.applies_to.
        "blocked_slot.create LECTURE_ONLY": ("lecture", {"action": "blocked_slot.create", "entity_type": "blocked_slot", "entity_id": "1", "extra": {"applies_to": "LECTURE_ONLY"}}),
        "blocked_slot.create EXAM_ONLY": ("exam", {"action": "blocked_slot.create", "entity_type": "blocked_slot", "entity_id": str(slot), "extra": {"applies_to": "EXAM_ONLY"}}),
        "blocked_slot.create BOTH": ("both", {"action": "blocked_slot.create", "entity_type": "blocked_slot", "entity_id": "3", "extra": {"applies_to": "BOTH"}}),
        "blocked_slot.update lecture->exam": ("both", {"action": "blocked_slot.update", "entity_type": "blocked_slot", "entity_id": "4", "extra": {"before": {"applies_to": "LECTURE_ONLY"}, "after": {"applies_to": "EXAM_ONLY"}}}),
        "blocked_slot.update exam->exam": ("exam", {"action": "blocked_slot.update", "entity_type": "blocked_slot", "entity_id": "5", "extra": {"before": {"applies_to": "EXAM_ONLY"}, "after": {"applies_to": "EXAM_ONLY"}}}),
        # A deletion logs no details: the slot's earlier entry decides.
        "blocked_slot.delete": ("exam", {"action": "blocked_slot.delete", "entity_type": "blocked_slot", "entity_id": str(slot), "created_at": at + timedelta(minutes=5)}),
        # The schedule items a conflict names: their rows ...
        "conflict.dismiss (rows)": ("lecture", {"action": "conflict.dismiss", "entity_type": "conflict_dismissal", "entity_id": "1", "extra": {"conflict_type": "room", "item_a_id": lecture_item.id, "item_b_id": lecture_item.id}}),
        "conflict.dismiss (lecture vs exam)": ("both", {"action": "conflict.dismiss", "entity_type": "conflict_dismissal", "entity_id": "2", "extra": {"conflict_type": "room", "item_a_id": lecture_item.id, "item_b_id": exam_item.id}}),
        # ... or a deleted item's own log entry.
        "conflict.dismiss (deleted item)": ("exam", {"action": "conflict.dismiss", "entity_type": "conflict_dismissal", "entity_id": str(dismissal), "extra": {"conflict_type": "time", "item_a_id": gone_item, "item_b_id": None}}),
        # Its conflict.dismiss entry, then as above.
        "conflict.restore": ("exam", {"action": "conflict.restore", "entity_type": "conflict_dismissal", "entity_id": str(dismissal), "extra": {"conflict_type": "time"}, "created_at": at + timedelta(minutes=5)}),
        # No timetable type recorded: only under "All".
        "conflict.dismiss.bulk": (None, {"action": "conflict.dismiss.bulk", "entity_type": "department", "entity_id": "1", "extra": {"department_id": 1, "count": 3}}),
        "conflict.dismiss (unknown items)": (None, {"action": "conflict.dismiss", "entity_type": "conflict_dismissal", "entity_id": "7", "extra": {"conflict_type": "time", "item_a_id": 123456, "item_b_id": None}}),
        "editor_access.grant": (None, {"action": "editor_access.grant", "entity_type": "editor_handover", "entity_id": "1", "extra": {"faculty_id": "SCI"}}),
        "editor_access.retract": (None, {"action": "editor_access.retract", "entity_type": "editor_handover", "entity_id": "1"}),
        "course.create": (None, {"action": "course.create", "entity_type": "course", "entity_id": str(course.id)}),
        "faculty.update": (None, {"action": "faculty.update", "entity_type": "faculty", "entity_id": "SCI"}),
        "department.create": (None, {"action": "department.create", "entity_type": "department", "entity_id": "1"}),
        "room.create": (None, {"action": "room.create", "entity_type": "room", "entity_id": "1"}),
        "user.invite": (None, {"action": "user.invite", "entity_type": "invitation", "entity_id": "1"}),
        "auth.impersonate.start": (None, {"action": "auth.impersonate.start", "entity_type": "user", "entity_id": "1"}),
        "calendar.session.create": (None, {"action": "calendar.session.create", "entity_type": "academic_session", "entity_id": "1"}),
        "realm.update": (None, {"action": "realm.update", "entity_type": "realm", "entity_id": "UG", "extra": {"changes": {}}}),
        "activity_log.export": (None, {"action": "activity_log.export", "entity_type": "activity_log_export", "extra": {"filters": {"type": "exam"}}}),
    }
    # The log entry a deleted schedule item left behind, read by the deleted-item conflict.
    await add_logs({"action": "schedule_item.exam.delete", "entity_type": "schedule_item", "entity_id": str(gone_item), "created_at": lagos(2025, 10, 1)})
    names = list(expected)
    created = dict(zip(names, await add_logs(*({"created_at": at, **expected[name][1]} for name in names))))

    window = custom("2025-11-10", "2025-11-10")
    lecture = set(await ids(admin, **window, type="lecture"))
    exam = set(await ids(admin, **window, type="exam"))
    everything = set(await ids(admin, **window))

    def named(*types):
        return {created[name] for name in names if expected[name][0] in types}

    assert lecture == named("lecture", "both"), sorted(n for n in names if created[n] in lecture ^ named("lecture", "both"))
    assert exam == named("exam", "both"), sorted(n for n in names if created[n] in exam ^ named("exam", "both"))
    # Neither export contains a row of the other type alone.
    assert not lecture & named("exam") and not exam & named("lecture")
    # Rows with no recorded type appear under All only.
    assert named(None) <= everything and not named(None) & (lecture | exam)
    assert everything == set(created.values())


async def test_categories_without_double_counting(admin):
    lecture, exam, course, conflict, realm, export = await add_logs(
        {"action": "schedule_item.lecture.create", "created_at": lagos(2025, 11, 10)},
        {"action": "schedule_item.exam.create", "created_at": lagos(2025, 11, 10)},
        {"action": "course.create", "created_at": lagos(2025, 11, 10)},
        {"action": "conflict.dismiss", "created_at": lagos(2025, 11, 10)},
        {"action": "realm.update", "created_at": lagos(2025, 11, 10)},
        {"action": "activity_log.export", "created_at": lagos(2025, 11, 10)},
    )
    window = custom("2025-11-10", "2025-11-10")
    # "Schedule items (all)" replaces Lecture/Exam: every item once, nothing twice.
    both = await ids(admin, **window, cat=["schedule_item", "schedule_item.lecture"])
    assert sorted(both) == sorted([lecture, exam])
    assert await ids(admin, **window, cat="schedule_item.lecture") == [lecture]
    assert set(await ids(admin, **window, cat="conflict,realm,activity_log")) == {conflict, realm, export}
    assert set(await ids(admin, **window, action=["course.create", "realm.update"])) == {course, realm}


async def test_users_roles_and_keyword(admin):
    mixed_case, deleted, impersonated, percent, underscore = await add_logs(
        {"action": "course.update", "user_email": "Ada.Lovelace@UNILAG.edu.ng", "user_role": "FACULTY_EDITOR", "description": "Renamed PHY101", "created_at": lagos(2025, 11, 10)},
        # Nobody has this address any more; the entry still matches it.
        {"action": "course.update", "user_email": "gone@unilag.edu.ng", "user_role": "FACULTY_VIEWER", "description": "Viewed", "created_at": lagos(2025, 11, 10)},
        # The effective role of an impersonated action is the one acted as.
        {"action": "course.update", "user_email": "admin@unilag.edu.ng", "user_role": "HOD", "description": "Approved",
         "extra": {"impersonation": {"real_role": "SUPER_ADMIN", "acting_as_role": "HOD", "acting_as_faculty_id": "SCI"}}, "created_at": lagos(2025, 11, 10)},
        {"action": "course.update", "description": "Discount 50% off", "created_at": lagos(2025, 11, 10)},
        {"action": "course.update", "description": "Discount 50_ off", "created_at": lagos(2025, 11, 10)},
    )
    window = custom("2025-11-10", "2025-11-10")
    assert await ids(admin, **window, user="ada.lovelace@unilag.edu.ng") == [mixed_case]
    assert await ids(admin, **window, user="GONE@unilag.edu.ng") == [deleted]
    assert await ids(admin, **window, role="HOD") == [impersonated]
    # Keyword wildcards are literal characters, and case doesn't matter.
    assert await ids(admin, **window, q="50%") == [percent]
    assert await ids(admin, **window, q="50_") == [underscore]
    assert await ids(admin, **window, q="renamed phy") == [mixed_case]


async def test_faculty_and_department(admin, campus):
    sci_course, physics, civil = campus["course"], campus["physics"], campus["civil"]
    (item,) = await add(ScheduleItem(course_id=sci_course.id, type="lecture", day_of_week="Monday", start_time=time(8), end_time=time(10), realm_key="UG"))
    (request,) = await add(ChangeRequest(semester_id=campus["semester"].id, realm_key="UG", timetable_type="lecture", action="ADD", course_id=sci_course.id))
    at = lagos(2025, 11, 10)
    rows = {
        "acted for SCI": {"action": "course.update", "user_faculty_id": "SCI"},
        "names SCI": {"action": "room.create", "extra": {"faculty_id": "SCI"}},
        "is SCI": {"action": "faculty.update", "entity_type": "faculty", "entity_id": "SCI"},
        "is Physics": {"action": "department.update", "entity_type": "department", "entity_id": str(physics.id)},
        "Physics in extra": {"action": "course.create", "entity_type": "course", "entity_id": "77", "extra": {"department_id": physics.id}},
        "Physics course": {"action": "course.update", "entity_type": "course", "entity_id": str(sci_course.id), "extra": {"title": "x"}},
        "Physics course in extra": {"action": "schedule_item.lecture.create", "entity_type": "schedule_item", "entity_id": "999", "extra": {"course_id": sci_course.id}},
        "Physics item": {"action": "schedule_item.lecture.update", "entity_type": "schedule_item", "entity_id": str(item.id), "extra": {"start_time": "08:00:00"}},
        "Physics request": {"action": "change_request.approve", "entity_type": "change_request", "entity_id": str(request.id)},
        "Civil": {"action": "conflict.dismiss.bulk", "entity_type": "department", "entity_id": str(civil.id), "extra": {"department_id": civil.id}},
        "nothing": {"action": "auth.login", "user_faculty_id": None},
    }
    created = dict(zip(rows, await add_logs(*({"created_at": at, **row} for row in rows.values()))))
    window = custom("2025-11-10", "2025-11-10")

    def names(found):
        return {name for name, id_ in created.items() if id_ in found}

    physics_rows = {"is Physics", "Physics in extra", "Physics course", "Physics course in extra", "Physics item", "Physics request"}
    assert names(await ids(admin, **window, faculty="SCI")) == {"acted for SCI", "names SCI", "is SCI"} | physics_rows
    assert names(await ids(admin, **window, dept=str(physics.id))) == physics_rows
    assert names(await ids(admin, **window, faculty="ENG")) == {"Civil"}


async def test_original_parameters_still_work(signed_in, make_user):
    admin, me = await signed_in(RoleEnum.SUPER_ADMIN)
    other = await make_user(RoleEnum.SUPER_VIEWER)
    item, _lookalike, mine, theirs = await add_logs(
        {"action": "schedule_item.lecture.create", "created_at": lagos(2025, 11, 10)},
        # "_" in the prefix is a plain character, not a wildcard.
        {"action": "scheduleXitem.lecture.create", "created_at": lagos(2025, 11, 10)},
        {"action": "course.create", "user_id": me["id"], "created_at": lagos(2025, 11, 10)},
        {"action": "course.create", "user_id": other["id"], "created_at": lagos(2025, 11, 10)},
    )
    window = custom("2025-11-10", "2025-11-10")
    assert await ids(admin, **window, action_prefix="schedule_item.") == [item]
    assert await ids(admin, **window, user_id=me["id"]) == [mine]
    assert await ids(admin, **window, action_prefix="course.", user_id=other["id"]) == [theirs]


async def test_paging_never_repeats_or_skips(admin):
    same_time = lagos(2025, 11, 10)
    created = await add_logs(*({"action": "course.update", "created_at": same_time} for _ in range(5)))
    window = custom("2025-11-10", "2025-11-10")
    pages = [await ids(admin, **window, limit=2, offset=offset) for offset in (0, 2, 4)]
    assert [id_ for page in pages for id_ in page] == sorted(created, reverse=True)


async def test_current_academic_session_preset(admin, campus):
    session = campus["session"]
    today = lagos_today()
    started = today - timedelta(days=40)

    # Nothing in the log says when the current session started yet.
    assert (await admin.get(LOGS, params={"range": "session"})).status_code == 422
    options = (await admin.get(OPTIONS)).json()
    assert options["session"] == {"id": session.id, "name": "2026/2027", "start": None}
    assert options["presets"]["session"] is None

    # Its creation is the fallback ...
    await add_logs({"action": "calendar.session.create", "entity_type": "academic_session", "entity_id": str(session.id),
                    "created_at": datetime.combine(started - timedelta(days=10), time(12), tzinfo=WAT)})
    assert (await admin.get(OPTIONS)).json()["session"]["start"] == (started - timedelta(days=10)).isoformat()
    # ... and becoming current is the start.
    _made_current, during = await add_logs(
        {"action": "calendar.session.current", "entity_type": "academic_session", "entity_id": str(session.id),
         "created_at": datetime.combine(started, time(9), tzinfo=WAT)},
        {"action": "course.create", "created_at": datetime.combine(started + timedelta(days=1), time(9), tzinfo=WAT)},
    )
    early = (await add_logs({"action": "course.create", "created_at": datetime.combine(started - timedelta(days=1), time(9), tzinfo=WAT)}))[0]
    options = (await admin.get(OPTIONS)).json()
    assert options["session"]["start"] == started.isoformat()
    assert options["presets"]["session"] == {"start": started.isoformat(), "end": today.isoformat()}
    found = set(await ids(admin, range="session", cat="course"))
    assert during in found and early not in found


# ---------- GET /audit/logs/options ----------

async def test_options_list_only_what_the_table_shows(admin, campus, make_user):
    ada = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="SCI", email="ada@unilag.edu.ng")
    await add(Faculty(id="ICE-SCI", name="ICE Science", realm_key="ICE"))
    await add_logs(
        {"action": "course.create", "user_email": "Ada@unilag.edu.ng", "user_role": "FACULTY_EDITOR", "created_at": lagos(2025, 11, 10)},
        {"action": "course.create", "user_email": "gone@unilag.edu.ng", "user_role": "FACULTY_VIEWER", "created_at": lagos(2025, 11, 10)},
        {"action": "auth.switch_realm", "realm_key": None, "user_email": "ada@unilag.edu.ng", "created_at": lagos(2025, 11, 11)},
        # Another portal's entries never show.
        {"action": "room.delete", "realm_key": "ICE", "user_email": "ice@unilag.edu.ng", "user_role": "DEO", "created_at": lagos(2025, 11, 10)},
    )
    response = await admin.get(OPTIONS)
    assert response.status_code == 200, response.text
    options = response.json()

    actions = {a["code"]: a for a in options["actions"]}
    assert actions["course.create"] == {"code": "course.create", "category": "course", "count": 2}
    assert actions["auth.switch_realm"]["category"] == "auth"
    assert "room.delete" not in actions
    users = {u["email"]: u["deleted"] for u in options["users"]}
    assert users["ada@unilag.edu.ng"] is False and users["gone@unilag.edu.ng"] is True
    assert "ice@unilag.edu.ng" not in users
    assert {"FACULTY_EDITOR", "FACULTY_VIEWER"} <= set(options["roles"]) and "DEO" not in options["roles"]
    assert [f["id"] for f in options["faculties"]] == ["ENG", "SCI"]  # by name: Engineering, Science
    assert {d["name"] for d in options["departments"]} == {"Physics", "Civil"}
    assert options["timezone"] == "Africa/Lagos"
    today = date.fromisoformat(options["today"])
    assert options["presets"]["last_7_days"] == {"start": (today - timedelta(days=6)).isoformat(), "end": today.isoformat()}
    assert options["last_12_months"] == {"start": earliest_export_start(today).isoformat(), "end": today.isoformat()}
    assert ada["email"] in users


# ---------- Who can read the log ----------

async def test_who_can_read_the_activity_log(signed_in, client, campus):
    """/audit/logs keeps its permission, and the options follow it (the effective role decides)."""
    for role, expected in [
        (RoleEnum.SUPER_ADMIN, 200),
        (RoleEnum.SUPER_VIEWER, 200),
        (RoleEnum.FACULTY_EDITOR, 403),
        (RoleEnum.FACULTY_VIEWER, 403),
        (RoleEnum.HOD, 403),
        (RoleEnum.DEO, 403),
        (RoleEnum.GS_ADMIN, 403),
        (RoleEnum.CITS_ADMIN, 403),
    ]:
        signed, _ = await signed_in(role, faculty_id="SCI" if role in (RoleEnum.FACULTY_EDITOR, RoleEnum.FACULTY_VIEWER, RoleEnum.HOD, RoleEnum.DEO) else None)
        for path in (LOGS, OPTIONS):
            assert (await signed.get(path)).status_code == expected, (role, path)

    for path in (LOGS, OPTIONS):
        assert (await client.get(path)).status_code == 401

    # A super admin acting as a HOD is a HOD here; acting as a super viewer can read.
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    assert (await admin.post(f"{API}/auth/impersonate", json={"role": "HOD", "faculty_id": "SCI"})).status_code == 200
    for path in (LOGS, OPTIONS):
        assert (await admin.get(path)).status_code == 403
    assert (await admin.post(f"{API}/auth/impersonate", json={"role": "SUPER_VIEWER"})).status_code == 200
    for path in (LOGS, OPTIONS):
        assert (await admin.get(path)).status_code == 200
