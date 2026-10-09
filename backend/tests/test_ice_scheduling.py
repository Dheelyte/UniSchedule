"""ICE's strict scheduling window and room clashes across realms (ICE realm phase 4)."""
from datetime import date

import pytest

from modules.auth.models import RoleEnum

API = "/api/v1"
SATURDAY, SUNDAY, MONDAY = "2026-10-10", "2026-10-11", "2026-10-12"
assert [date.fromisoformat(d).strftime("%A") for d in (SATURDAY, SUNDAY, MONDAY)] == ["Saturday", "Sunday", "Monday"]


async def _ok(response, status: int = 200):
    assert response.status_code == status, response.text
    return response.json() if response.content else None


def _lecture(realm: dict, **overrides) -> dict:
    return {
        "course_id": realm["course"]["id"],
        "room_ids": [realm["room"]["id"]],
        "faculty_id": "ENG",
        "day_of_week": "Friday",
        "start_time": "10:00:00",
        "end_time": "12:00:00",
        "type": "lecture",
        **overrides,
    }


def _exam(realm: dict, **overrides) -> dict:
    exam = {"type": "exam", "day_of_week": None, "exam_date": SATURDAY, "start_time": "10:00:00", "end_time": "13:00:00"}
    return _lecture(realm, **{**exam, **overrides})


async def _schedule(realm: dict, payload: dict):
    return await realm["admin"].post(f"{API}/timetable/schedule-items", json=payload)


@pytest.fixture
async def campus(make_client, make_user, login) -> dict:
    """UG and ICE, each with a current semester and a course, sharing two rooms."""
    setup = make_client()
    await login(setup, (await make_user(RoleEnum.SUPER_ADMIN))["email"])
    await _ok(await setup.post(f"{API}/timetable/faculties", json={"id": "ENG", "name": "Engineering"}))
    await _ok(await setup.post(f"{API}/timetable/faculties", json={"id": "DLI", "name": "Distance Learning", "is_special": True}))
    department = await _ok(await setup.post(f"{API}/timetable/departments", json={"name": "Civil", "faculty_id": "ENG"}))
    room = await _ok(await setup.post(f"{API}/timetable/rooms", json={"name": "ENG 101", "faculty_id": "ENG"}))
    other_room = await _ok(await setup.post(f"{API}/timetable/rooms", json={"name": "ENG 102", "faculty_id": "ENG"}))

    realms = {}
    for key in ("UG", "ICE"):
        admin = make_client()
        await login(admin, (await make_user(RoleEnum.SUPER_ADMIN))["email"], realm=key)
        editor = make_client()
        await login(editor, (await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG", realm=key))["email"])
        session = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": f"{key} 2025/2026"}))
        semester = await _ok(await admin.post(
            f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": session["id"]}
        ))
        course = await _ok(await admin.post(f"{API}/timetable/courses", json={
            "code": f"{key}201", "title": f"{key} Mechanics", "department_id": department["id"], "level": 200,
        }))
        realms[key] = {
            "key": key, "admin": admin, "editor": editor, "room": room, "other_room": other_room,
            "semester": semester, "course": course,
        }
    return realms


# --- Strict window (SPEC 8.1) -------------------------------------------------

async def test_ice_accepts_a_friday_evening_lecture_on_the_quarter_hour(campus):
    item = await _ok(await _schedule(campus["ICE"], _lecture(campus["ICE"], start_time="19:15:00", end_time="20:45:00")))
    assert (item["day_of_week"], item["start_time"], item["end_time"]) == ("Friday", "19:15:00", "20:45:00")


@pytest.mark.parametrize("overrides", [
    {"day_of_week": "Monday"},
    {"day_of_week": None},
    {"start_time": "06:45:00", "end_time": "08:00:00"},
    {"start_time": "19:10:00", "end_time": "20:45:00"},
    {"start_time": "19:15:00", "end_time": "20:50:00"},
    {"start_time": "19:15:30", "end_time": "20:45:00"},
    {"start_time": "20:00:00", "end_time": "21:15:00"},
    {"start_time": "12:00:00", "end_time": "12:00:00"},
    {"start_time": "12:00:00", "end_time": "11:00:00"},
], ids=["monday", "no-day", "before-07", "off-grid-start", "off-grid-end", "seconds", "after-21", "empty", "backwards"])
async def test_ice_rejects_lectures_outside_its_window(campus, overrides):
    ice = campus["ICE"]
    response = await _schedule(ice, _lecture(ice, **overrides))
    assert response.status_code == 400, response.text
    assert await _ok(await ice["admin"].get(f"{API}/timetable/schedule-items")) == []


async def test_ice_exams_must_fall_on_an_exam_day(campus):
    ice = campus["ICE"]
    await _ok(await _schedule(ice, _exam(ice, exam_date=SUNDAY, start_time="19:00:00", end_time="21:00:00")))

    for overrides in ({"exam_date": MONDAY}, {"exam_date": None}, {"exam_date": SUNDAY, "start_time": "06:00:00"}):
        response = await _schedule(ice, _exam(ice, **overrides))
        assert response.status_code == 400, f"{overrides}: {response.text}"


async def test_ice_checks_the_window_when_an_item_is_edited(campus):
    ice = campus["ICE"]
    item = await _ok(await _schedule(ice, _lecture(ice)))
    url = f"{API}/timetable/schedule-items/{item['id']}"

    for change in ({"day_of_week": "Monday"}, {"start_time": "06:00:00"}, {"end_time": "12:10:00"}, {"end_time": "09:00:00"}):
        response = await ice["admin"].put(url, json=change)
        assert response.status_code == 400, f"{change}: {response.text}"

    moved = await _ok(await ice["admin"].put(url, json={"day_of_week": "Sunday", "start_time": "07:00:00", "end_time": "09:30:00"}))
    assert (moved["day_of_week"], moved["start_time"], moved["end_time"]) == ("Sunday", "07:00:00", "09:30:00")


async def test_ice_checks_the_window_on_change_requests(campus):
    ice = campus["ICE"]
    item = await _ok(await _schedule(ice, _lecture(ice)))
    url = f"{API}/timetable/change-requests"

    def request(action: str, **overrides) -> dict:
        return _lecture(ice, timetable_type="lecture", action=action, reason="please", **overrides)

    rejected = [
        request("ADD", day_of_week="Monday"),
        request("ADD", start_time="19:10:00", end_time="20:45:00"),
        request("MODIFY", target_schedule_item_id=item["id"], day_of_week="Tuesday"),
        # No day given: the target's Friday stands, but the time is still checked.
        request("MODIFY", target_schedule_item_id=item["id"], day_of_week=None, start_time="06:00:00"),
    ]
    for body in rejected:
        response = await ice["editor"].post(url, json=body)
        assert response.status_code == 400, f"{body}: {response.text}"

    await _ok(await ice["editor"].post(url, json=request("ADD", day_of_week="Saturday")))
    await _ok(await ice["editor"].post(url, json=request(
        "MODIFY", target_schedule_item_id=item["id"], day_of_week=None, start_time="14:00:00", end_time="16:00:00",
    )))
    # Removing needs no day or time at all.
    await _ok(await ice["editor"].post(url, json={
        "timetable_type": "lecture", "action": "REMOVE", "course_id": ice["course"]["id"],
        "target_schedule_item_id": item["id"],
    }))


async def test_ice_blocked_slots_must_sit_on_ice_days(campus):
    ice = campus["ICE"]
    semester = {"semester_id": ice["semester"]["id"]}
    url = f"{API}/timetable/blocked-slots"

    for body in (
        {"name": "Midweek", "day_of_week": "Wednesday", "applies_to": "LECTURE_ONLY"},
        {"name": "Midweek", "day_of_week": "Wednesday", "applies_to": "BOTH"},
        {"name": "Monday paper", "date": MONDAY, "applies_to": "EXAM_ONLY"},
    ):
        response = await ice["admin"].post(url, json={**body, **semester})
        assert response.status_code == 400, f"{body}: {response.text}"

    await _ok(await ice["admin"].post(url, json={"name": "Service", "day_of_week": "Sunday", "applies_to": "BOTH", **semester}))
    await _ok(await ice["admin"].post(url, json={"name": "Convocation", "date": SUNDAY, "applies_to": "EXAM_ONLY", **semester}))


async def test_ug_gets_no_new_day_or_time_validation(campus):
    ug = campus["UG"]
    # Outside the UG window, off its 30-minute grid and on a day UG doesn't teach: accepted, as before.
    await _ok(await _schedule(ug, _lecture(ug, start_time="07:30:00", end_time="09:00:00")))
    item = await _ok(await _schedule(ug, _lecture(ug, day_of_week="Sunday", start_time="18:10:00", end_time="22:05:00")))
    await _ok(await ug["admin"].put(f"{API}/timetable/schedule-items/{item['id']}", json={"start_time": "06:40:00"}))
    await _ok(await _schedule(ug, _exam(ug, exam_date=SUNDAY, start_time="06:00:00", end_time="08:00:00")))
    await _ok(await ug["admin"].post(f"{API}/timetable/blocked-slots", json={
        "name": "Sunday", "day_of_week": "Sunday", "applies_to": "LECTURE_ONLY", "semester_id": ug["semester"]["id"],
    }))
    await _ok(await ug["editor"].post(f"{API}/timetable/change-requests", json=_lecture(
        ug, timetable_type="lecture", action="ADD", day_of_week="Sunday", start_time="06:10:00", end_time="07:05:00",
    )))


# --- Cross-realm room clashes (SPEC 8.2) --------------------------------------

@pytest.mark.parametrize("first, second", [("UG", "ICE"), ("ICE", "UG")])
async def test_a_room_cannot_hold_two_realms_lectures_at_once(campus, first, second):
    holder, late = campus[first], campus[second]
    await _ok(await _schedule(holder, _lecture(holder, start_time="10:00:00", end_time="12:00:00")))

    response = await _schedule(late, _lecture(late, start_time="11:00:00", end_time="13:00:00"))
    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    for part in ("ENG 101", {"UG": "Undergraduate", "ICE": "ICE"}[first], f"{first}201", "Friday", "10:00–12:00"):
        assert part in detail, detail
    assert await _ok(await late["admin"].get(f"{API}/timetable/schedule-items")) == []

    # A different room, another day, or straight after is fine.
    await _ok(await _schedule(late, _lecture(late, start_time="11:00:00", end_time="13:00:00", room_ids=[late["other_room"]["id"]])))
    await _ok(await _schedule(late, _lecture(late, start_time="11:00:00", end_time="13:00:00", day_of_week="Saturday")))
    await _ok(await _schedule(late, _lecture(late, start_time="12:00:00", end_time="14:00:00")))


async def test_exams_clash_across_realms_on_the_same_date_only(campus):
    ug, ice = campus["UG"], campus["ICE"]
    await _ok(await _schedule(ug, _exam(ug, start_time="09:00:00", end_time="12:00:00")))

    response = await _schedule(ice, _exam(ice))
    assert response.status_code == 409, response.text
    assert "10 Oct 2026 09:00–12:00" in response.json()["detail"]

    await _ok(await _schedule(ice, _exam(ice, exam_date=SUNDAY)))
    # A lecture is a different kind of session: the UI warns, the API allows it (SPEC 8.3).
    await _ok(await _schedule(ice, _lecture(ice, day_of_week="Saturday", start_time="10:00:00", end_time="12:00:00")))


async def test_moving_an_item_onto_another_realms_booking_is_refused(campus):
    ug, ice = campus["UG"], campus["ICE"]
    await _ok(await _schedule(ug, _lecture(ug)))
    item = await _ok(await _schedule(ice, _lecture(ice, room_ids=[ice["other_room"]["id"]])))
    url = f"{API}/timetable/schedule-items/{item['id']}"

    response = await ice["admin"].put(url, json={"room_ids": [ice["room"]["id"]]})
    assert response.status_code == 409, response.text
    await _ok(await ice["admin"].put(url, json={"start_time": "12:00:00", "end_time": "14:00:00"}))
    response = await ice["admin"].put(url, json={"room_ids": [ice["room"]["id"]], "start_time": "11:45:00"})
    assert response.status_code == 409, response.text

    [stored] = await _ok(await ice["admin"].get(f"{API}/timetable/schedule-items"))
    assert (stored["room_ids"], stored["start_time"]) == ([ice["other_room"]["id"]], "12:00:00")


async def test_approving_a_change_request_into_a_clash_is_refused(campus):
    ug, ice = campus["UG"], campus["ICE"]
    request = await _ok(await ice["editor"].post(f"{API}/timetable/change-requests", json=_lecture(
        ice, timetable_type="lecture", action="ADD", reason="extra class",
    )))
    # UG takes the room after the request was made.
    await _ok(await _schedule(ug, _lecture(ug)))

    review = f"{API}/timetable/change-requests/{request['id']}/review"
    response = await ice["admin"].post(review, json={"approve": True})
    assert response.status_code == 409, response.text
    [pending] = await _ok(await ice["admin"].get(f"{API}/timetable/change-requests"))
    assert pending["status"] == "PENDING"
    assert await _ok(await ice["admin"].get(f"{API}/timetable/schedule-items")) == []

    # Once UG moves, the same request goes through.
    [ug_item] = await _ok(await ug["admin"].get(f"{API}/timetable/schedule-items"))
    await _ok(await ug["admin"].put(f"{API}/timetable/schedule-items/{ug_item['id']}", json={"day_of_week": "Monday"}))
    assert (await _ok(await ice["admin"].post(review, json={"approve": True})))["status"] == "APPROVED"


async def test_special_faculties_are_exempt_from_cross_realm_clashes(campus):
    ug, ice = campus["UG"], campus["ICE"]
    await _ok(await _schedule(ug, _lecture(ug, faculty_id="DLI")))
    # The holder is special...
    await _ok(await _schedule(ice, _lecture(ice)))
    # ...and so is the newcomer, against ICE's ordinary booking.
    await _ok(await _schedule(ug, _lecture(ug, faculty_id="DLI", start_time="11:00:00", end_time="13:00:00")))


async def test_only_current_semester_items_hold_a_room(campus):
    ug, ice = campus["UG"], campus["ICE"]
    old = await _ok(await _schedule(ug, _lecture(ug)))
    # A new UG session leaves that lecture in a past semester.
    session = await _ok(await ug["admin"].post(f"{API}/calendar/sessions", json={"name": "UG 2026/2027"}))
    await _ok(await ug["admin"].post(f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": session["id"]}))

    await _ok(await _schedule(ice, _lecture(ice)))
    assert await _ok(await ice["admin"].get(f"{API}/timetable/external-bookings")) == []
    # Editing the past item isn't checked either: it no longer holds the room.
    await _ok(await ug["admin"].put(f"{API}/timetable/schedule-items/{old['id']}", json={"end_time": "13:00:00"}))


# --- External bookings (SPEC 8.4) ---------------------------------------------

async def test_external_bookings_lists_the_other_realms_current_items(campus, client):
    ug, ice = campus["UG"], campus["ICE"]
    lecture = await _ok(await _schedule(ug, _lecture(ug)))
    exam = await _ok(await _schedule(ug, _exam(ug, faculty_id="DLI", room_ids=[ug["other_room"]["id"]])))
    mine = await _ok(await _schedule(ice, _lecture(ice, day_of_week="Sunday")))
    url = f"{API}/timetable/external-bookings"

    # Any signed-in user of the realm, with exactly these fields.
    for viewer in (ice["admin"], ice["editor"]):
        assert await _ok(await viewer.get(url)) == [
            {
                "id": lecture["id"], "realm_key": "UG", "realm_name": "Undergraduate", "type": "lecture",
                "room_ids": [ug["room"]["id"]], "day_of_week": "Friday", "exam_date": None,
                "start_time": "10:00:00", "end_time": "12:00:00",
                "course_code": "UG201", "is_special_faculty": False,
            },
            {
                "id": exam["id"], "realm_key": "UG", "realm_name": "Undergraduate", "type": "exam",
                "room_ids": [ug["other_room"]["id"]], "day_of_week": None, "exam_date": SATURDAY,
                "start_time": "10:00:00", "end_time": "13:00:00",
                "course_code": "UG201", "is_special_faculty": True,
            },
        ]

    theirs = await _ok(await ug["editor"].get(url))
    assert [(b["id"], b["realm_key"], b["course_code"]) for b in theirs] == [(mine["id"], "ICE", "ICE201")]

    assert (await client.get(url)).status_code == 401
