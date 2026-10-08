"""Every realm-scoped resource is invisible and untouchable from another realm (ICE realm phase 3)."""
import inspect
import re

import pytest
from sqlalchemy import select

from core import mail
from core.database import async_session_maker
from modules.audit.models import ActivityLog
from modules.audit.repository import AuditRepository
from modules.auth.models import RoleEnum
from modules.auth.repository import AuthRepository
from modules.calendar.repository import CalendarRepository
from modules.timetable.models import ChangeRequest, Course, ScheduleItem
from modules.timetable.repository import TimetableRepository

API = "/api/v1"
# A lecture day each realm really uses, so later scheduling rules don't disturb these tests.
DAY = {"UG": "Monday", "ICE": "Friday"}
OTHER = {"UG": "ICE", "ICE": "UG"}


async def _ok(response, status: int = 200):
    assert response.status_code == status, response.text
    return response.json() if response.content else None


async def _ids(client, path: str, **params) -> set[int]:
    return {row["id"] for row in await _ok(await client.get(f"{API}{path}", params=params))}


def _lecture(realm: dict, **overrides) -> dict:
    return {
        "course_id": realm["course"]["id"],
        "room_ids": [realm["room"]["id"]],
        "faculty_id": "ENG",
        "day_of_week": DAY[realm["key"]],
        "start_time": "10:00:00",
        "end_time": "12:00:00",
        "type": "lecture",
        **overrides,
    }


@pytest.fixture
def sent_emails(monkeypatch):
    """Capture notification emails instead of sending them: a list of recipient lists."""
    sent: list[list[str]] = []

    async def _capture(emails, title, message, link=None):
        sent.append(sorted(emails))

    monkeypatch.setattr(mail.EmailService, "send_generic_notification", staticmethod(_capture))
    return sent


@pytest.fixture
async def world(make_client, make_user, login, sent_emails) -> dict:
    """UG and ICE, each with one of every realm-scoped resource, built through the API.

    Faculty, department and room are shared. Both realms use the same course code.
    """
    setup = make_client()
    await login(setup, (await make_user(RoleEnum.SUPER_ADMIN))["email"])
    await _ok(await setup.post(f"{API}/timetable/faculties", json={"id": "ENG", "name": "Engineering"}))
    department = await _ok(await setup.post(f"{API}/timetable/departments", json={"name": "Civil", "faculty_id": "ENG"}))
    room = await _ok(await setup.post(f"{API}/timetable/rooms", json={"name": "ENG 101", "faculty_id": "ENG"}))

    realms = {}
    for key in ("UG", "ICE"):
        admin = make_client()
        await login(admin, (await make_user(RoleEnum.SUPER_ADMIN))["email"], realm=key)
        editor_user = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG", realm=key)
        editor = make_client()
        await login(editor, editor_user["email"])

        session = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": f"{key} 2025/2026"}))
        semester = await _ok(await admin.post(
            f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": session["id"]}
        ))
        course = await _ok(await admin.post(f"{API}/timetable/courses", json={
            "code": "CEG201", "title": f"{key} Mechanics", "department_id": department["id"], "level": 200,
            "scope": "INTERFACULTY",
        }))
        realm = {
            "key": key, "admin": admin, "editor": editor, "editor_user": editor_user,
            "department": department, "room": room, "session": session, "semester": semester, "course": course,
        }
        realm["item"] = await _ok(await admin.post(f"{API}/timetable/schedule-items", json=_lecture(realm)))
        realm["slot"] = await _ok(await admin.post(f"{API}/timetable/blocked-slots", json={
            "name": f"{key} break", "day_of_week": "Wednesday", "start_time": "12:00:00", "end_time": "13:00:00",
            "applies_to": "LECTURE_ONLY", "semester_id": semester["id"],
        }))
        realm["enrollment"] = await _ok(await admin.post(f"{API}/timetable/enrollments", json={
            "course_id": course["id"], "department_id": department["id"], "level": 200,
        }), 201)
        realm["dismissal"] = await _ok(await admin.post(f"{API}/timetable/conflict-dismissals", json={
            "conflict_type": "time", "item_a_id": realm["item"]["id"], "reason": "agreed",
        }))
        realm["request"] = await _ok(await editor.post(f"{API}/timetable/change-requests", json=_lecture(
            realm, timetable_type="lecture", action="ADD", start_time="14:00:00", end_time="16:00:00", reason="extra class",
        )))
        realms[key] = realm
    return realms


async def _snapshot(client, realm: dict, *, admin: bool) -> dict:
    """What a signed-in user can list. `realm` only supplies the ids to ask about."""
    semester_id = realm["semester"]["id"]
    seen = {
        "sessions": await _ids(client, "/calendar/sessions"),
        "semesters": await _ids(client, f"/calendar/sessions/{realm['session']['id']}/semesters"),
        "current": (await _ok(await client.get(f"{API}/calendar/semesters/current")) or {}).get("id"),
        "courses": await _ids(client, "/timetable/courses"),
        "items": await _ids(client, "/timetable/schedule-items"),
        "items_in_semester": await _ids(client, "/timetable/schedule-items", semester_id=semester_id),
        "slots": await _ids(client, "/timetable/blocked-slots"),
        "slots_in_semester": await _ids(client, "/timetable/blocked-slots", semester_id=semester_id),
        "enrollments": await _ids(client, "/timetable/enrollments"),
        "course_enrollments": await _ids(client, f"/timetable/courses/{realm['course']['id']}/enrollments"),
        "dismissals": await _ids(client, "/timetable/conflict-dismissals"),
        "requests": await _ids(client, "/timetable/change-requests"),
        "requests_in_semester": await _ids(client, "/timetable/change-requests", semester_id=semester_id),
    }
    if admin:
        logs = await _ok(await client.get(f"{API}/audit/logs", params={"limit": 500}))
        seen["logged_courses"] = {log["entity_id"] for log in logs if log["action"] == "course.create"}
    return seen


def _own(realm: dict, *, admin: bool) -> dict:
    """The snapshot a user of `realm` should get when asking about their own realm's ids."""
    expected = {
        "sessions": {realm["session"]["id"]},
        "semesters": {realm["semester"]["id"]},
        "current": realm["semester"]["id"],
        "courses": {realm["course"]["id"]},
        "items": {realm["item"]["id"]},
        "items_in_semester": {realm["item"]["id"]},
        "slots": {realm["slot"]["id"]},
        "slots_in_semester": {realm["slot"]["id"]},
        "enrollments": {realm["enrollment"]["id"]},
        "course_enrollments": {realm["enrollment"]["id"]},
        "dismissals": {realm["dismissal"]["id"]},
        "requests": {realm["request"]["id"]},
        "requests_in_semester": {realm["request"]["id"]},
    }
    if admin:
        expected["logged_courses"] = {str(realm["course"]["id"])}
    return expected


# --- Lists ------------------------------------------------------------------

async def test_each_realm_lists_only_its_own_data(world):
    for key in ("UG", "ICE"):
        mine, theirs = world[key], world[OTHER[key]]
        for role, admin in (("admin", True), ("editor", False)):
            client = mine[role]
            assert await _snapshot(client, mine, admin=admin) == _own(mine, admin=admin), f"{key} {role}"

            # Asking by another realm's ids finds nothing; the unfiltered lists are still only mine.
            foreign = await _snapshot(client, theirs, admin=False)
            for name in ("semesters", "items_in_semester", "slots_in_semester", "course_enrollments", "requests_in_semester"):
                assert foreign[name] == set(), f"{key} {role} {name}"
            for name in ("sessions", "courses", "items", "slots", "enrollments", "dismissals", "requests"):
                assert foreign[name] == _own(mine, admin=False)[name], f"{key} {role} {name}"


async def test_super_admin_sees_only_the_realm_they_are_signed_in_to(world):
    admin = world["UG"]["admin"]
    assert await _snapshot(admin, world["UG"], admin=True) == _own(world["UG"], admin=True)

    await _ok(await admin.post(f"{API}/auth/switch-realm", json={"realm": "ICE"}))
    assert await _snapshot(admin, world["ICE"], admin=True) == _own(world["ICE"], admin=True)


async def test_new_rows_are_stored_in_the_callers_realm(world):
    async with async_session_maker() as session:
        for key in ("UG", "ICE"):
            realm = world[key]
            assert (await session.get(Course, realm["course"]["id"])).realm_key == key
            assert (await session.get(ScheduleItem, realm["item"]["id"])).realm_key == key
            assert (await session.get(ChangeRequest, realm["request"]["id"])).realm_key == key
        logs = (await session.execute(select(ActivityLog))).scalars().all()

    by_course = {log.entity_id: log.realm_key for log in logs if log.action == "course.create"}
    assert by_course == {str(world[key]["course"]["id"]): key for key in ("UG", "ICE")}
    # Three super admins signed in to UG (one of them for setup) and one to ICE, plus an editor each.
    logins = sorted(log.realm_key for log in logs if log.action == "auth.login")
    assert logins == ["ICE", "ICE", "UG", "UG", "UG"]


# --- Another realm's ids are not found --------------------------------------

async def test_another_realms_id_behaves_exactly_like_a_missing_id(world):
    """Same status and body on every endpoint that takes an id, so the two can't be told apart.

    Most of these are 404s; deleting a course or a schedule item is a silent 200, as it always was.
    """
    missing = 999999
    for key in ("UG", "ICE"):
        mine, theirs = world[key], world[OTHER[key]]
        admin, editor = mine["admin"], mine["editor"]
        before = await _snapshot(theirs["admin"], theirs, admin=False)

        def attempts(course_id, item_id, slot_id, semester_id, session_id, dismissal_id, request_id) -> dict:
            semester = {"semester_id": semester_id}
            enrollment = {"course_id": course_id, "department_id": mine["department"]["id"], "level": 200}
            return {
                "update course": (admin.put(f"{API}/timetable/courses/{course_id}", json={"title": "Taken"}), 404),
                "delete course": (admin.delete(f"{API}/timetable/courses/{course_id}"), 200),
                "update item": (admin.put(f"{API}/timetable/schedule-items/{item_id}", json={"start_time": "09:00:00"}), 404),
                "delete item": (admin.delete(f"{API}/timetable/schedule-items/{item_id}"), 200),
                "schedule course": (admin.post(f"{API}/timetable/schedule-items", json=_lecture(
                    mine, course_id=course_id, start_time="16:00:00", end_time="17:00:00",
                )), 404),
                "delete slot": (admin.delete(f"{API}/timetable/blocked-slots/{slot_id}"), 404),
                "block semester": (admin.post(f"{API}/timetable/blocked-slots", json={
                    "name": "Mine now", "day_of_week": "Thursday", "applies_to": "LECTURE_ONLY", **semester,
                }), 404),
                "read locks": (admin.get(f"{API}/timetable/locks", params=semester), 404),
                "lock": (admin.put(f"{API}/timetable/locks/lecture", params=semester, json={"is_locked": True}), 404),
                "request edit": (editor.post(f"{API}/timetable/locks/lecture/edit-requests", params=semester, json={}), 404),
                "semester in session": (admin.post(
                    f"{API}/calendar/semesters", json={"name": "Second Semester", "session_id": session_id}
                ), 404),
                "semesters of session": (admin.get(f"{API}/calendar/sessions/{session_id}/semesters"), 200),
                "enroll": (admin.post(f"{API}/timetable/enrollments", json={**enrollment, "level": 300}), 404),
                "unenroll": (admin.delete(f"{API}/timetable/enrollments", params=enrollment), 404),
                "course enrollments": (admin.get(f"{API}/timetable/courses/{course_id}/enrollments"), 200),
                "dismiss": (admin.post(f"{API}/timetable/conflict-dismissals", json={
                    "conflict_type": "duplicate", "item_a_id": item_id, "reason": "no",
                }), 404),
                "restore": (admin.delete(f"{API}/timetable/conflict-dismissals/{dismissal_id}"), 404),
                "review": (admin.post(f"{API}/timetable/change-requests/{request_id}/review", json={"approve": True}), 404),
                "request for course": (editor.post(f"{API}/timetable/change-requests", json=_lecture(
                    mine, timetable_type="lecture", action="ADD", course_id=course_id,
                )), 404),
                "request on item": (editor.post(f"{API}/timetable/change-requests", json=_lecture(
                    mine, timetable_type="lecture", action="REMOVE", target_schedule_item_id=item_id,
                )), 404),
            }

        foreign = attempts(
            theirs["course"]["id"], theirs["item"]["id"], theirs["slot"]["id"], theirs["semester"]["id"],
            theirs["session"]["id"], theirs["dismissal"]["id"], theirs["request"]["id"],
        )
        absent = attempts(*[missing] * 7)
        for name, (attempt, status) in foreign.items():
            theirs_response, missing_response = await attempt, await absent[name][0]
            # One message echoes the id ("Schedule item 7 not found"), so compare with numbers masked.
            theirs_body, missing_body = (re.sub(r"\d+", "N", r.text) for r in (theirs_response, missing_response))
            assert (theirs_response.status_code, theirs_body) == (missing_response.status_code, missing_body), f"{key}: {name}"
            assert theirs_response.status_code == status, f"{key}: {name}: {theirs_response.text}"

        # A bulk dismissal skips what it can't find, so their item is skipped too.
        bulk = await _ok(await admin.post(f"{API}/timetable/conflict-dismissals/bulk", json={
            "department_id": mine["department"]["id"], "reason": "no",
            "dismissals": [{"conflict_type": "duplicate", "item_a_id": theirs["item"]["id"]}],
        }))
        assert bulk == []

        # Nothing of theirs was touched, including by the deletes that answered 200.
        assert await _snapshot(theirs["admin"], theirs, admin=False) == before, f"{key} changed {OTHER[key]}"
        locks = await _ok(await theirs["admin"].get(f"{API}/timetable/locks", params={"semester_id": theirs["semester"]["id"]}))
        assert [lock["is_locked"] for lock in locks] == [False, False]


async def test_a_lock_holds_only_in_its_own_realm(world):
    ug, ice = world["UG"], world["ICE"]
    await _ok(await ug["admin"].put(
        f"{API}/timetable/locks/lecture", params={"semester_id": ug["semester"]["id"]}, json={"is_locked": True}
    ))

    response = await ug["admin"].post(f"{API}/timetable/schedule-items", json=_lecture(ug, start_time="13:00:00", end_time="14:00:00"))
    assert response.status_code == 423, response.text
    await _ok(await ice["admin"].post(f"{API}/timetable/schedule-items", json=_lecture(ice, start_time="13:00:00", end_time="14:00:00")))


async def test_a_blocked_slot_blocks_only_its_own_realm(world):
    ug, ice = world["UG"], world["ICE"]
    await _ok(await ug["admin"].post(f"{API}/timetable/blocked-slots", json={
        "name": "UG assembly", "day_of_week": "Thursday", "applies_to": "LECTURE_ONLY", "semester_id": ug["semester"]["id"],
    }))

    response = await ug["admin"].post(f"{API}/timetable/schedule-items", json=_lecture(ug, day_of_week="Thursday"))
    assert response.status_code == 400, response.text
    await _ok(await ice["admin"].post(f"{API}/timetable/schedule-items", json=_lecture(ice, day_of_week="Thursday")))


# --- Calendar ---------------------------------------------------------------

async def test_ice_calendar_leaves_ugs_current_semester_alone(world):
    ug, ice = world["UG"], world["ICE"]

    second = await _ok(await ice["admin"].post(
        f"{API}/calendar/semesters", json={"name": "Second Semester", "session_id": ice["session"]["id"]}
    ))
    assert (await _ok(await ice["admin"].get(f"{API}/calendar/semesters/current")))["id"] == second["id"]
    assert (await _ok(await ug["admin"].get(f"{API}/calendar/semesters/current")))["id"] == ug["semester"]["id"]

    new_session = await _ok(await ice["admin"].post(f"{API}/calendar/sessions", json={"name": "ICE 2026/2027"}))
    assert await _ok(await ice["admin"].get(f"{API}/calendar/semesters/current")) is None
    sessions = {s["id"]: s["is_current"] for s in await _ok(await ice["admin"].get(f"{API}/calendar/sessions"))}
    assert sessions == {ice["session"]["id"]: False, new_session["id"]: True}

    assert (await _ok(await ug["admin"].get(f"{API}/calendar/semesters/current")))["id"] == ug["semester"]["id"]
    sessions = {s["id"]: s["is_current"] for s in await _ok(await ug["admin"].get(f"{API}/calendar/sessions"))}
    assert sessions == {ug["session"]["id"]: True}
    # UG can still schedule: its current semester was never demoted.
    await _ok(await ug["admin"].post(f"{API}/timetable/schedule-items", json=_lecture(ug, day_of_week="Tuesday")))


async def test_a_realm_has_one_current_semester_named_from_its_config(world):
    admin, session_id = world["UG"]["admin"], world["UG"]["session"]["id"]

    response = await admin.post(f"{API}/calendar/semesters", json={"name": "Third Semester", "session_id": session_id})
    assert response.status_code == 400, response.text
    assert (await _ok(await admin.get(f"{API}/calendar/semesters/current")))["id"] == world["UG"]["semester"]["id"]

    second = await _ok(await admin.post(f"{API}/calendar/semesters", json={"name": "Second Semester", "session_id": session_id}))
    semesters = await _ok(await admin.get(f"{API}/calendar/sessions/{session_id}/semesters"))
    assert {s["id"]: s["is_current"] for s in semesters} == {world["UG"]["semester"]["id"]: False, second["id"]: True}


# --- Courses ----------------------------------------------------------------

async def test_course_code_is_unique_per_realm_and_checked_against_the_config(world):
    for key in ("UG", "ICE"):
        admin, department_id = world[key]["admin"], world[key]["department"]["id"]
        course = {"code": "CEG201", "title": "Again", "department_id": department_id, "level": 200}

        response = await admin.post(f"{API}/timetable/courses", json=course)
        assert response.status_code == 400, response.text
        assert "already exists" in response.json()["detail"]

        response = await admin.post(f"{API}/timetable/courses", json={**course, "code": "CEG801", "level": 800})
        assert response.status_code == 400, response.text
        response = await admin.post(f"{API}/timetable/courses", json={**course, "code": "CEG301", "semester": "Third Semester"})
        assert response.status_code == 400, response.text

        created = await _ok(await admin.post(f"{API}/timetable/courses", json={
            **course, "code": "CEG301", "level": 300, "semester": "",
        }))
        assert created["semester"] is None
        updated = await _ok(await admin.put(f"{API}/timetable/courses/{created['id']}", json={"semester": "Second Semester"}))
        assert updated["semester"] == "Second Semester"
        response = await admin.put(f"{API}/timetable/courses/{created['id']}", json={"level": 50})
        assert response.status_code == 400, response.text
        # Renaming onto a code the realm already has is refused; the other realm's copy doesn't count.
        response = await admin.put(f"{API}/timetable/courses/{created['id']}", json={"code": "CEG201"})
        assert response.status_code == 400, response.text


# --- Notifications ----------------------------------------------------------

async def _titles(client) -> list[str]:
    return [n["title"] for n in await _ok(await client.get(f"{API}/notifications"))]


async def test_priority_override_reaches_only_the_same_realms_editors(world, sent_emails):
    conflict = "Timetable conflict: please review"
    expected_emails = []
    for key in ("UG", "ICE"):
        realm = world[key]
        general = await _ok(await realm["admin"].post(f"{API}/timetable/courses", json={
            "code": "GST101", "title": "Use of English", "scope": "UNIVERSITY_WIDE",
        }))
        # Overlaps the realm's interfaculty lecture in the shared room.
        await _ok(await realm["admin"].post(f"{API}/timetable/schedule-items", json=_lecture(
            realm, course_id=general["id"], start_time="11:00:00", end_time="13:00:00",
        )))
        expected_emails.append([realm["editor_user"]["email"]])

        assert sent_emails == expected_emails
        assert (await _titles(realm["editor"])).count(conflict) == 1
    # The ICE clash didn't add a second notification for the UG editor.
    assert (await _titles(world["UG"]["editor"])).count(conflict) == 1


async def test_notifications_to_super_admins_name_the_realm(world):
    for key, name in (("UG", "Undergraduate"), ("ICE", "ICE")):
        realm = world[key]
        await _ok(await realm["admin"].put(
            f"{API}/timetable/locks/lecture", params={"semester_id": realm["semester"]["id"]}, json={"is_locked": True}
        ))
        response = await realm["editor"].post(
            f"{API}/timetable/locks/lecture/edit-requests", params={"semester_id": realm["semester"]["id"]},
            json={"reason": "late change"},
        )
        assert response.status_code == 204, response.text

    # Super admins are cross-realm: each gets every realm's requests, told apart by title and link.
    notifications = await _ok(await world["UG"]["admin"].get(f"{API}/notifications"))
    assert {(n["title"], n["link"]) for n in notifications} == {
        ("Undergraduate: Schedule change requested: CEG201", "/requests?realm=UG"),
        ("ICE: Schedule change requested: CEG201", "/requests?realm=ICE"),
        ("Undergraduate: Edit access requested for lecture timetable", "/timetable/lectures?realm=UG"),
        ("ICE: Edit access requested for lecture timetable", "/timetable/lectures?realm=ICE"),
    }


# --- Change requests --------------------------------------------------------

async def test_approving_a_change_request_schedules_in_its_own_realm(world):
    ice = world["ICE"]
    reviewed = await _ok(await ice["admin"].post(
        f"{API}/timetable/change-requests/{ice['request']['id']}/review", json={"approve": True}
    ))
    assert reviewed["status"] == "APPROVED"
    assert reviewed["course_code"] == "CEG201"

    new_id = reviewed["resulting_schedule_item_id"]
    assert await _ids(ice["admin"], "/timetable/schedule-items") == {ice["item"]["id"], new_id}
    assert await _ids(world["UG"]["admin"], "/timetable/schedule-items") == {world["UG"]["item"]["id"]}
    async with async_session_maker() as session:
        assert (await session.get(ScheduleItem, new_id)).realm_key == "ICE"


# --- Repositories -----------------------------------------------------------

REALM_SCOPED_READS = {
    CalendarRepository: [
        "get_sessions", "get_session", "get_semesters", "get_semester", "get_current_semester",
        "disable_current_sessions", "disable_current_semesters",
    ],
    TimetableRepository: [
        "get_courses", "get_course", "is_course_referenced_by_schedule",
        "get_schedule_items", "get_schedule_item", "get_schedule_items_by_ids",
        "get_dismissals", "get_dismissal", "find_dismissal",
        "get_blocked_slots", "get_relevant_blocked_slots", "get_blocked_slot",
        "get_lock", "list_locks", "upsert_lock",
        "list_enrollments", "get_enrollment",
        "get_change_request", "list_change_requests",
    ],
    AuthRepository: ["get_users", "get_invitations", "get_faculty_editors_in_faculties"],
    AuditRepository: ["list"],
}


def test_realm_scoped_repository_methods_require_the_realm():
    """Forgetting the realm is a TypeError, not a leak."""
    for repository, methods in REALM_SCOPED_READS.items():
        for method in methods:
            parameter = inspect.signature(getattr(repository, method)).parameters.get("realm_key")
            assert parameter is not None, f"{repository.__name__}.{method} takes no realm_key"
            assert parameter.kind is inspect.Parameter.KEYWORD_ONLY, f"{repository.__name__}.{method}"
            assert parameter.default is inspect.Parameter.empty, f"{repository.__name__}.{method}"
