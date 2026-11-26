"""Shifting the exam timetable through the API: preview, apply, who may do it, and what blocks it."""
from datetime import date

import pytest

from modules.auth.models import RoleEnum

API = "/api/v1"
# August 2026: Mon 10 ... Fri 14, Sat 15, Sun 16, Mon 17
assert date(2026, 8, 14).strftime("%A") == "Friday"


async def _ok(response, status: int = 200):
    assert response.status_code == status, response.text
    return response.json() if response.content else None


@pytest.fixture
async def ug(make_client, make_user, login) -> dict:
    """A UG super admin with two faculties, a room, a current semester and three courses."""
    admin = make_client()
    await login(admin, (await make_user(RoleEnum.SUPER_ADMIN))["email"], realm="UG")
    faculties = {}
    for fid, name in (("ENG", "Engineering"), ("LAW", "Law")):
        faculties[fid] = (await _ok(await admin.post(f"{API}/timetable/faculties", json={"id": fid, "name": name})))["id"]
    department = await _ok(await admin.post(f"{API}/timetable/departments", json={"name": "Civil", "faculty_id": "ENG"}))
    room = await _ok(await admin.post(f"{API}/timetable/rooms", json={"name": "ENG 101", "faculty_id": "ENG"}))
    session = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": "UG 2025/2026"}))
    await _ok(await admin.put(f"{API}/calendar/sessions/{session['id']}/current"))
    semester = await _ok(await admin.post(f"{API}/calendar/semesters", json={"name": "Second Semester", "session_id": session["id"]}))
    await _ok(await admin.put(f"{API}/calendar/semesters/{semester['id']}/current"))
    courses = [
        await _ok(await admin.post(f"{API}/timetable/courses", json={
            "code": f"CVE{n}", "title": f"Course {n}", "department_id": department["id"], "level": 300,
        }))
        for n in (301, 302, 303)
    ]
    return {"admin": admin, "room": room, "semester": semester, "courses": courses, "faculties": faculties,
            "make_user": make_user, "make_client": make_client, "login": login}


async def _exam(ug: dict, course: int, day: str, start="09:00:00", end="12:00:00", faculty="ENG", week=1) -> dict:
    return await _ok(await ug["admin"].post(f"{API}/timetable/schedule-items", json={
        "course_id": ug["courses"][course]["id"], "room_ids": [ug["room"]["id"]], "faculty_id": faculty,
        "type": "exam", "day_of_week": None, "exam_date": day, "start_time": start, "end_time": end, "week": week,
    }))


async def _exam_dates(ug: dict) -> dict[int, str]:
    items = await _ok(await ug["admin"].get(f"{API}/timetable/schedule-items?semester_id={ug['semester']['id']}&type=exam"))
    return {i["id"]: i["exam_date"] for i in items}


def _shift(ug: dict, **body) -> dict:
    return {"semester_id": ug["semester"]["id"], **body}


async def test_preview_reports_the_moves_and_changes_nothing(ug):
    fri = await _exam(ug, 0, "2026-08-14")
    sat = await _exam(ug, 1, "2026-08-15")

    preview = await _ok(await ug["admin"].post(f"{API}/timetable/exams/shift/preview", json=_shift(ug, mode="days", amount=1)))

    assert preview["applied"] is False
    assert (preview["selected"], preview["moving"]) == (2, 2)
    assert preview["date_changes"] == [
        {"from_date": "2026-08-14", "to_date": "2026-08-15", "exams": 1},
        {"from_date": "2026-08-15", "to_date": "2026-08-17", "exams": 1},  # Sunday skipped
    ]
    assert (preview["first_date_after"], preview["last_date_after"]) == ("2026-08-15", "2026-08-17")
    assert await _exam_dates(ug) == {fri["id"]: "2026-08-14", sat["id"]: "2026-08-15"}


async def test_applying_moves_the_exams_and_their_week_numbers(ug):
    sat = await _exam(ug, 0, "2026-08-15", week=1)

    result = await _ok(await ug["admin"].post(f"{API}/timetable/exams/shift", json=_shift(ug, mode="days", amount=1)))

    assert result["applied"] is True and result["moving"] == 1
    items = await _ok(await ug["admin"].get(f"{API}/timetable/schedule-items?semester_id={ug['semester']['id']}&type=exam"))
    moved = next(i for i in items if i["id"] == sat["id"])
    assert (moved["exam_date"], moved["week"]) == ("2026-08-17", 2)
    assert (moved["start_time"], moved["room_ids"]) == ("09:00:00", [ug["room"]["id"]])


async def test_holidays_are_skipped_and_partly_blocked_times_are_pushed_on(ug):
    semester_id = ug["semester"]["id"]
    await _ok(await ug["admin"].post(f"{API}/timetable/blocked-slots", json={
        "name": "Public holiday", "date": "2026-08-12", "applies_to": "EXAM_ONLY", "semester_id": semester_id,
    }))
    await _ok(await ug["admin"].post(f"{API}/timetable/blocked-slots", json={
        "name": "Jumat", "day_of_week": "Friday", "start_time": "12:00:00", "end_time": "15:00:00",
        "applies_to": "EXAM_ONLY", "semester_id": semester_id,
    }))
    tue = await _exam(ug, 0, "2026-08-11")
    thu_midday = await _exam(ug, 1, "2026-08-13", start="12:00:00", end="15:00:00")

    result = await _ok(await ug["admin"].post(f"{API}/timetable/exams/shift", json=_shift(ug, mode="days", amount=1)))

    assert await _exam_dates(ug) == {tue["id"]: "2026-08-13", thu_midday["id"]: "2026-08-15"}
    assert [p["course_code"] for p in result["pushed"]] == ["CVE302"]
    assert "Jumat" in result["pushed"][0]["reason"]


async def test_only_the_chosen_faculty_and_section_move(ug):
    early = await _exam(ug, 0, "2026-08-10")
    eng = await _exam(ug, 1, "2026-08-12")
    law = await _exam(ug, 2, "2026-08-12", faculty="LAW")

    await _ok(await ug["admin"].post(f"{API}/timetable/exams/shift", json=_shift(
        ug, mode="weeks", amount=2, faculty_ids=["ENG"], from_date="2026-08-11",
    )))

    assert await _exam_dates(ug) == {early["id"]: "2026-08-10", eng["id"]: "2026-08-26", law["id"]: "2026-08-12"}


async def test_moving_to_a_new_start_date(ug):
    first = await _exam(ug, 0, "2026-08-10")
    second = await _exam(ug, 1, "2026-08-11")

    await _ok(await ug["admin"].post(f"{API}/timetable/exams/shift", json=_shift(ug, mode="start_date", new_start_date="2026-08-24")))

    assert await _exam_dates(ug) == {first["id"]: "2026-08-24", second["id"]: "2026-08-25"}


async def test_a_sunday_start_date_is_refused(ug):
    await _exam(ug, 0, "2026-08-10")
    response = await ug["admin"].post(f"{API}/timetable/exams/shift/preview", json=_shift(ug, mode="start_date", new_start_date="2026-08-16"))
    assert response.status_code == 400 and "not an exam day" in response.text


async def test_a_zero_or_missing_distance_is_rejected(ug):
    assert (await ug["admin"].post(f"{API}/timetable/exams/shift/preview", json=_shift(ug, mode="days", amount=0))).status_code == 422
    assert (await ug["admin"].post(f"{API}/timetable/exams/shift/preview", json=_shift(ug, mode="start_date"))).status_code == 422


async def test_a_locked_exam_timetable_cannot_be_shifted(ug):
    await _exam(ug, 0, "2026-08-10")
    await _ok(await ug["admin"].put(f"{API}/timetable/locks/exam?semester_id={ug['semester']['id']}", json={"is_locked": True}))

    response = await ug["admin"].post(f"{API}/timetable/exams/shift", json=_shift(ug, mode="days", amount=1))

    assert response.status_code == 423


@pytest.mark.parametrize("role", [RoleEnum.FACULTY_EDITOR, RoleEnum.SUPER_VIEWER])
async def test_only_super_admins_can_shift_exams(ug, role):
    user = await ug["make_user"](role, faculty_id="ENG" if role == RoleEnum.FACULTY_EDITOR else None)
    client = ug["make_client"]()
    await ug["login"](client, user["email"], realm="UG")

    for path in ("/exams/shift/preview", "/exams/shift"):
        response = await client.post(f"{API}/timetable{path}", json=_shift(ug, mode="days", amount=1))
        assert response.status_code == 403, path


async def test_ice_is_not_offered_the_shift_yet(make_client, make_user, login):
    admin = make_client()
    await login(admin, (await make_user(RoleEnum.SUPER_ADMIN))["email"], realm="ICE")
    session = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": "ICE 2025/2026"}))
    await _ok(await admin.put(f"{API}/calendar/sessions/{session['id']}/current"))
    semester = await _ok(await admin.post(f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": session["id"]}))

    response = await admin.post(f"{API}/timetable/exams/shift/preview", json={"semester_id": semester["id"], "mode": "days", "amount": 1})

    assert response.status_code == 400 and "isn't available" in response.text


async def test_nothing_to_move_is_not_applied(ug):
    response = await ug["admin"].post(f"{API}/timetable/exams/shift", json=_shift(ug, mode="days", amount=1))
    assert response.status_code == 400


async def test_a_clash_with_another_programme_in_a_shared_hall_is_shown_and_blocks_the_shift(ug):
    # ICE holds an exam on Saturday 15 Aug in the same physical hall as UG's ENG 101.
    ice = ug["make_client"]()
    await ug["login"](ice, (await ug["make_user"](RoleEnum.SUPER_ADMIN))["email"], realm="ICE")
    await _ok(await ice.post(f"{API}/timetable/faculties", json={"id": "ENG", "name": "Engineering"}))
    # ICE faculty ids are generated by the server, so look it up.
    faculty_id = (await _ok(await ice.get(f"{API}/timetable/faculties")))[0]["id"]
    department = await _ok(await ice.post(f"{API}/timetable/departments", json={"name": "Civil", "faculty_id": faculty_id}))
    ice_room = await _ok(await ice.post(f"{API}/timetable/rooms", json={"name": "ENG 101", "faculty_id": faculty_id}))
    await _ok(await ug["admin"].put(f"{API}/timetable/rooms/{ug['room']['id']}/hall", json={"room_id": ice_room["id"]}))
    session = await _ok(await ice.post(f"{API}/calendar/sessions", json={"name": "ICE 2025/2026"}))
    await _ok(await ice.put(f"{API}/calendar/sessions/{session['id']}/current"))
    semester = await _ok(await ice.post(f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": session["id"]}))
    await _ok(await ice.put(f"{API}/calendar/semesters/{semester['id']}/current"))
    course = await _ok(await ice.post(f"{API}/timetable/courses", json={
        "code": "ICE201", "title": "ICE Mechanics", "department_id": department["id"], "level": 200,
    }))
    await _ok(await ice.post(f"{API}/timetable/schedule-items", json={
        "course_id": course["id"], "room_ids": [ice_room["id"]], "faculty_id": faculty_id, "type": "exam",
        "day_of_week": None, "exam_date": "2026-08-15", "start_time": "10:00:00", "end_time": "13:00:00",
    }))
    fri = await _exam(ug, 0, "2026-08-14")  # 09:00-12:00, would land on Saturday at an overlapping time

    preview = await _ok(await ug["admin"].post(f"{API}/timetable/exams/shift/preview", json=_shift(ug, mode="days", amount=1)))
    assert preview["clashes"] == [{
        "course_code": "CVE301", "date": "2026-08-15", "start_time": "09:00:00", "end_time": "12:00:00",
        "room": "ENG 101", "other_realm": preview["clashes"][0]["other_realm"], "other_course": "ICE201",
    }]

    response = await ug["admin"].post(f"{API}/timetable/exams/shift", json=_shift(ug, mode="days", amount=1))
    assert response.status_code == 409
    assert await _exam_dates(ug) == {fri["id"]: "2026-08-14"}
