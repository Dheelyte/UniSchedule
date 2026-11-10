"""Reads that keep page loads small: all semesters in one call, one timetable
type's items, room usage counts, and compressed responses."""
from modules.auth.models import RoleEnum

API = "/api/v1"


async def _ok(response, status: int = 200):
    assert response.status_code == status, response.text
    return response.json()


async def _setup(admin, key: str):
    faculty = await _ok(await admin.post(f"{API}/timetable/faculties", json={"id": f"SCI{key}", "name": "Science"}))
    dept = await _ok(await admin.post(f"{API}/timetable/departments", json={"name": "Physics", "faculty_id": faculty["id"]}))
    room = await _ok(await admin.post(f"{API}/timetable/rooms", json={"name": "LT 1", "faculty_id": faculty["id"]}))
    other = await _ok(await admin.post(f"{API}/timetable/rooms", json={"name": "LT 2", "faculty_id": faculty["id"]}))
    sessions = []
    for name in (f"{key} 2024/2025", f"{key} 2025/2026"):
        session = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": name}))
        await _ok(await admin.put(f"{API}/calendar/sessions/{session['id']}/current"))
        sessions.append(session)
    semesters = []
    for name in ("First Semester", "Second Semester"):
        semesters.append(await _ok(await admin.post(
            f"{API}/calendar/semesters", json={"name": name, "session_id": sessions[1]["id"]},
        )))
    await _ok(await admin.put(f"{API}/calendar/semesters/{semesters[0]['id']}/current"))
    course = await _ok(await admin.post(f"{API}/timetable/courses", json={
        "code": "PHY101", "title": "Physics", "department_id": dept["id"], "level": 100,
    }))
    lecture = await _ok(await admin.post(f"{API}/timetable/schedule-items", json={
        "course_id": course["id"], "room_ids": [room["id"]], "faculty_id": faculty["id"],
        "day_of_week": "Monday", "start_time": "18:00:00" if key == "ICE" else "10:00:00",
        "end_time": "20:00:00" if key == "ICE" else "12:00:00", "type": "lecture",
    }))
    exam = await _ok(await admin.post(f"{API}/timetable/schedule-items", json={
        "course_id": course["id"], "room_ids": [room["id"], other["id"]], "faculty_id": faculty["id"],
        "exam_date": "2026-03-02", "start_time": "09:00:00", "end_time": "12:00:00", "type": "exam",
    }))
    return {"sessions": sessions, "semesters": semesters, "room": room, "other": other, "lecture": lecture, "exam": exam}


async def test_all_semesters_in_one_call(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    ug = await _setup(admin, "UG")
    rows = await _ok(await admin.get(f"{API}/calendar/semesters"))
    assert [(r["id"], r["session_name"]) for r in rows] == [
        (s["id"], "UG 2025/2026") for s in ug["semesters"]
    ]
    assert rows[0]["is_current"] is True and rows[1]["is_current"] is False
    # Another realm's semesters are not listed.
    ice, _ = await signed_in(RoleEnum.SUPER_ADMIN, login_realm="ICE")
    assert await _ok(await ice.get(f"{API}/calendar/semesters")) == []


async def test_schedule_items_of_one_type(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    ug = await _setup(admin, "UG")
    url = f"{API}/timetable/schedule-items?semester_id={ug['semesters'][0]['id']}"
    assert {i["id"] for i in await _ok(await admin.get(url))} == {ug["lecture"]["id"], ug["exam"]["id"]}
    assert [i["id"] for i in await _ok(await admin.get(url + "&type=lecture"))] == [ug["lecture"]["id"]]
    assert [i["id"] for i in await _ok(await admin.get(url + "&type=exam"))] == [ug["exam"]["id"]]
    assert (await admin.get(url + "&type=party")).status_code == 422


async def test_room_usage_counts_each_rooms_items(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    ug = await _setup(admin, "UG")
    usage = await _ok(await admin.get(f"{API}/timetable/rooms/usage"))
    assert usage == {str(ug["room"]["id"]): 2, str(ug["other"]["id"]): 1}
    # Counted in the caller's realm only.
    ice, _ = await signed_in(RoleEnum.SUPER_ADMIN, login_realm="ICE")
    assert await _ok(await ice.get(f"{API}/timetable/rooms/usage")) == {}


async def test_big_responses_are_compressed(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    for i in range(30):
        await _ok(await admin.post(f"{API}/timetable/faculties", json={"id": f"F{i}", "name": f"Faculty number {i}"}))
    response = await admin.get(f"{API}/timetable/faculties?all=true", headers={"Accept-Encoding": "gzip"})
    assert response.headers.get("content-encoding") == "gzip"
    assert len(response.json()) == 30
