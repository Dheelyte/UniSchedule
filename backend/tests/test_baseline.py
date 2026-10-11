"""Pins today's (pre-realm) behaviour, so later phases can't change UG by accident."""
import pytest

from modules.auth.models import RoleEnum

API = "/api/v1"


@pytest.fixture
async def admin(make_client, make_user, login):
    """A client signed in as a super admin."""
    user = await make_user(RoleEnum.SUPER_ADMIN)
    client = make_client()
    await login(client, user["email"])
    return client


async def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


async def _seed_timetable(admin) -> dict:
    """A current semester plus one faculty, department, room and course."""
    session = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": "2025/2026"}))
    semester = await _ok(await admin.post(
        f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": session["id"]}
    ))
    await _ok(await admin.post(f"{API}/timetable/faculties", json={"id": "ENG", "name": "Engineering"}))
    department = await _ok(await admin.post(
        f"{API}/timetable/departments", json={"name": "Civil Engineering", "faculty_id": "ENG"}
    ))
    room = await _ok(await admin.post(
        f"{API}/timetable/rooms", json={"name": "ENG 101", "capacity": 100, "faculty_id": "ENG"}
    ))
    course = await _ok(await admin.post(f"{API}/timetable/courses", json={
        "code": "CEG201", "title": "Mechanics", "department_id": department["id"], "level": 200,
    }))
    return {"session": session, "semester": semester, "department": department, "room": room, "course": course}


def _lecture(seed: dict, **overrides) -> dict:
    return {
        "course_id": seed["course"]["id"],
        "room_ids": [seed["room"]["id"]],
        "faculty_id": "ENG",
        "day_of_week": "Monday",
        "start_time": "10:00:00",
        "end_time": "12:00:00",
        "type": "lecture",
        **overrides,
    }


async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "message": "App is Healthy"}


async def test_login_then_me(client, make_user, login):
    user = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")

    assert (await client.get(f"{API}/auth/me")).status_code == 401

    response = await login(client, user["email"])
    assert response.json() == {"message": "Login successful"}

    me = await _ok(await client.get(f"{API}/auth/me"))
    assert me["sub"] == str(user["id"])
    assert me["email"] == user["email"]
    assert me["role"] == "FACULTY_EDITOR"
    assert me["real_role"] == "FACULTY_EDITOR"
    assert me["faculty_id"] == "ENG"
    assert me["impersonating"] is False


async def test_login_with_wrong_password_is_401(client, make_user):
    user = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")
    response = await client.post(f"{API}/auth/login", json={"email": user["email"], "password": "wrong"})
    assert response.status_code == 401


async def test_faculty_editor_cannot_create_course_in_another_faculty(admin, make_client, make_user, login):
    await _ok(await admin.post(f"{API}/timetable/faculties", json={"id": "ENG", "name": "Engineering"}))
    await _ok(await admin.post(f"{API}/timetable/faculties", json={"id": "SCI", "name": "Science"}))
    own = await _ok(await admin.post(f"{API}/timetable/departments", json={"name": "Civil", "faculty_id": "ENG"}))
    other = await _ok(await admin.post(f"{API}/timetable/departments", json={"name": "Physics", "faculty_id": "SCI"}))

    editor_user = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")
    editor = make_client()
    await login(editor, editor_user["email"])

    response = await editor.post(f"{API}/timetable/courses", json={
        "code": "PHY101", "title": "Physics I", "department_id": other["id"], "level": 100,
    })
    assert response.status_code == 403, response.text

    response = await editor.post(f"{API}/timetable/courses", json={
        "code": "CEG101", "title": "Intro", "department_id": own["id"], "level": 100,
    })
    assert response.status_code == 200, response.text


async def test_scheduling_into_locked_lecture_timetable_is_423(admin):
    seed = await _seed_timetable(admin)
    semester_id = seed["semester"]["id"]

    lock = await _ok(await admin.put(
        f"{API}/timetable/locks/lecture", params={"semester_id": semester_id}, json={"is_locked": True}
    ))
    assert lock["is_locked"] is True

    response = await admin.post(f"{API}/timetable/schedule-items", json=_lecture(seed))
    assert response.status_code == 423, response.text

    # The lock is per timetable type: exams in the same semester stay open.
    response = await admin.post(f"{API}/timetable/schedule-items", json=_lecture(
        seed, type="exam", day_of_week=None, exam_date="2026-01-12",
    ))
    assert response.status_code == 200, response.text


async def test_scheduling_into_blocked_slot_is_400(admin):
    seed = await _seed_timetable(admin)

    await _ok(await admin.post(f"{API}/timetable/blocked-slots", json={
        "name": "Jumat",
        "day_of_week": "Monday",
        "start_time": "11:00:00",
        "end_time": "13:00:00",
        "applies_to": "LECTURE_ONLY",
        "semester_id": seed["semester"]["id"],
    }))

    response = await admin.post(f"{API}/timetable/schedule-items", json=_lecture(seed))
    assert response.status_code == 400, response.text
    assert "blocked slot 'Jumat'" in response.json()["detail"]

    # Back-to-back with the block, and the same time on another day, are both fine.
    response = await admin.post(f"{API}/timetable/schedule-items", json=_lecture(
        seed, start_time="09:00:00", end_time="11:00:00",
    ))
    assert response.status_code == 200, response.text
    response = await admin.post(f"{API}/timetable/schedule-items", json=_lecture(seed, day_of_week="Tuesday"))
    assert response.status_code == 200, response.text


async def test_new_session_demotes_previous_current_semester(admin):
    first = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": "2024/2025"}))
    semester = await _ok(await admin.post(
        f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": first["id"]}
    ))
    assert semester["is_current"] is True
    current = await _ok(await admin.get(f"{API}/calendar/semesters/current"))
    assert current["id"] == semester["id"]

    second = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": "2025/2026"}))
    assert second["is_current"] is True

    assert await _ok(await admin.get(f"{API}/calendar/semesters/current")) is None
    sessions = {s["id"]: s for s in await _ok(await admin.get(f"{API}/calendar/sessions"))}
    assert sessions[first["id"]]["is_current"] is False
    assert sessions[second["id"]]["is_current"] is True
    semesters = await _ok(await admin.get(f"{API}/calendar/sessions/{first['id']}/semesters"))
    assert [s["is_current"] for s in semesters] == [False]

    # Scheduling needs a current semester, so it is refused until one is created.
    await _ok(await admin.post(f"{API}/timetable/faculties", json={"id": "ENG", "name": "Engineering"}))
    response = await admin.post(f"{API}/timetable/schedule-items", json={
        "course_id": 1, "room_ids": [], "faculty_id": "ENG", "day_of_week": "Monday",
        "start_time": "10:00:00", "end_time": "12:00:00",
    })
    assert response.status_code == 400, response.text
