"""ICE's strict scheduling window, and clashes between realms over the same physical hall."""
from datetime import date

import pytest

from core.database import async_session_maker
from modules.auth.models import RoleEnum
from modules.realms.defaults import ICE_CONFIG
from modules.realms.models import Realm

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
        "faculty_id": realm["faculty"],
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


async def _link(realm: dict, room: dict, other_room: dict):
    """Mark `realm`'s room and another realm's room as the same physical hall."""
    return await realm["admin"].put(f"{API}/timetable/rooms/{room['id']}/hall", json={"room_id": other_room["id"]})


@pytest.fixture
async def campus(make_client, make_user, login) -> dict:
    """UG and ICE, each with its own faculties, department, two rooms, current semester and a course.

    The rooms are separate rows per realm. "ENG 101" and "ENG 102" are each linked
    across the two realms as one physical hall; "ENG 103" is not linked to anything.
    """
    realms = {}
    for key in ("UG", "ICE"):
        admin = make_client()
        await login(admin, (await make_user(RoleEnum.SUPER_ADMIN))["email"], realm=key)
        faculty = (await _ok(await admin.post(f"{API}/timetable/faculties", json={"id": "ENG", "name": "Engineering"})))["id"]
        special = (await _ok(await admin.post(
            f"{API}/timetable/faculties", json={"id": "DLI", "name": "Distance Learning", "is_special": True}
        )))["id"]
        department = await _ok(await admin.post(f"{API}/timetable/departments", json={"name": "Civil", "faculty_id": faculty}))
        room, other_room, unlinked_room = [
            await _ok(await admin.post(f"{API}/timetable/rooms", json={"name": name, "faculty_id": faculty}))
            for name in ("ENG 101", "ENG 102", "ENG 103")
        ]
        editor = make_client()
        await login(editor, (await make_user(RoleEnum.FACULTY_EDITOR, faculty_id=faculty, realm=key))["email"])
        session = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": f"{key} 2025/2026"}))
        await _ok(await admin.put(f"{API}/calendar/sessions/{session['id']}/current"))
        semester = await _ok(await admin.post(
            f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": session["id"]}
        ))
        await _ok(await admin.put(f"{API}/calendar/semesters/{semester['id']}/current"))
        course = await _ok(await admin.post(f"{API}/timetable/courses", json={
            "code": f"{key}201", "title": f"{key} Mechanics", "department_id": department["id"], "level": 200,
        }))
        realms[key] = {
            "key": key, "admin": admin, "editor": editor, "faculty": faculty, "special": special,
            "department": department, "room": room, "other_room": other_room, "unlinked_room": unlinked_room,
            "semester": semester, "course": course,
        }
    ug, ice = realms["UG"], realms["ICE"]
    for name in ("room", "other_room"):
        await _ok(await _link(ug, ug[name], ice[name]))
    return realms


# --- Strict window (SPEC 8.1) -------------------------------------------------

async def test_ice_accepts_a_friday_evening_lecture_on_the_quarter_hour(campus):
    item = await _ok(await _schedule(campus["ICE"], _lecture(campus["ICE"], start_time="19:15:00", end_time="20:45:00")))
    assert (item["day_of_week"], item["start_time"], item["end_time"]) == ("Friday", "19:15:00", "20:45:00")


@pytest.mark.parametrize("day", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])
async def test_ice_lectures_can_be_on_any_day(campus, day):
    ice = campus["ICE"]
    item = await _ok(await _schedule(ice, _lecture(ice, day_of_week=day, start_time="07:00:00", end_time="09:15:00")))
    assert item["day_of_week"] == day
    # The rest of ICE's window still applies on a weekday.
    for overrides in ({"start_time": "06:45:00", "end_time": "08:00:00"}, {"start_time": "19:10:00", "end_time": "20:45:00"}):
        assert (await _schedule(ice, _lecture(ice, day_of_week=day, **overrides))).status_code == 400


@pytest.mark.parametrize("overrides", [
    {"day_of_week": "Someday"},
    {"day_of_week": None},
    {"start_time": "06:45:00", "end_time": "08:00:00"},
    {"start_time": "19:10:00", "end_time": "20:45:00"},
    {"start_time": "19:15:00", "end_time": "20:50:00"},
    {"start_time": "19:15:30", "end_time": "20:45:00"},
    {"start_time": "20:00:00", "end_time": "21:15:00"},
    {"start_time": "12:00:00", "end_time": "12:00:00"},
    {"start_time": "12:00:00", "end_time": "11:00:00"},
], ids=["not-a-day", "no-day", "before-07", "off-grid-start", "off-grid-end", "seconds", "after-21", "empty", "backwards"])
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

    await _ok(await ice["admin"].put(url, json={"day_of_week": "Monday"}))
    for change in ({"day_of_week": "Someday"}, {"start_time": "06:00:00"}, {"end_time": "12:10:00"}, {"end_time": "09:00:00"}):
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
        request("ADD", day_of_week="Someday"),
        request("ADD", start_time="19:10:00", end_time="20:45:00"),
        request("MODIFY", target_schedule_item_id=item["id"], day_of_week="Tuesday", start_time="06:00:00"),
        # No day given: the target's Friday stands, but the time is still checked.
        request("MODIFY", target_schedule_item_id=item["id"], day_of_week=None, start_time="06:00:00"),
    ]
    for body in rejected:
        response = await ice["editor"].post(url, json=body)
        assert response.status_code == 400, f"{body}: {response.text}"

    await _ok(await ice["editor"].post(url, json=request("ADD", day_of_week="Saturday")))
    await _ok(await ice["editor"].post(url, json=request("ADD", day_of_week="Wednesday")))
    await _ok(await ice["editor"].post(url, json=request("MODIFY", target_schedule_item_id=item["id"], day_of_week="Tuesday")))
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

    # Exams are still Friday to Sunday only, so a block for an exam date can't sit on a Monday.
    body = {"name": "Monday paper", "date": MONDAY, "applies_to": "EXAM_ONLY"}
    response = await ice["admin"].post(url, json={**body, **semester})
    assert response.status_code == 400, response.text
    # Lectures run all week, so a weekday can be blocked for them.
    await _ok(await ice["admin"].post(url, json={"name": "Midweek", "day_of_week": "Wednesday", "applies_to": "LECTURE_ONLY", **semester}))
    await _ok(await ice["admin"].post(url, json={"name": "Midweek both", "day_of_week": "Thursday", "applies_to": "BOTH", **semester}))

    await _ok(await ice["admin"].post(url, json={"name": "Service", "day_of_week": "Sunday", "applies_to": "BOTH", **semester}))
    await _ok(await ice["admin"].post(url, json={"name": "Convocation", "date": SUNDAY, "applies_to": "EXAM_ONLY", **semester}))
    # A weekly exam block follows the same rule.
    response = await ice["admin"].post(url, json={"name": "Every Monday", "day_of_week": "Monday", "applies_to": "EXAM_ONLY", **semester})
    assert response.status_code == 400, response.text
    await _ok(await ice["admin"].post(url, json={"name": "Every Sunday", "day_of_week": "Sunday", "applies_to": "EXAM_ONLY", **semester}))


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


async def test_ice_exams_stay_on_friday_to_sunday(campus):
    ice = campus["ICE"]
    for exam_date, weekday in ((MONDAY, "Monday"), ("2026-10-14", "Wednesday"), ("2026-10-15", "Thursday")):
        assert date.fromisoformat(exam_date).strftime("%A") == weekday
        response = await _schedule(ice, _exam(ice, exam_date=exam_date))
        assert response.status_code == 400, f"{weekday}: {response.text}"
        assert response.json()["detail"] == "ICE exams run on Friday, Saturday, Sunday only"
    # An undated exam is checked by its day, and a lecture on the same Monday is fine.
    assert (await _schedule(ice, _exam(ice, exam_date=None, day_of_week="Monday"))).status_code == 400
    await _ok(await _schedule(ice, _lecture(ice, day_of_week="Monday")))
    request = _exam(ice, exam_date=MONDAY, timetable_type="exam", action="ADD", reason="please")
    assert (await ice["editor"].post(f"{API}/timetable/change-requests", json=request)).status_code == 400


@pytest.fixture
async def weekend_only_pg(make_client, make_user, login):
    """PG as a strict realm that teaches Friday to Sunday, which is what ICE was. The
    `realms` table is not emptied between tests, so the row is put back afterwards."""
    async with async_session_maker() as session:
        realm = await session.get(Realm, "PG")
        original = realm.config
        realm.config = {**ICE_CONFIG, "lecture_days": ["Friday", "Saturday", "Sunday"]}
        await session.commit()
    try:
        admin = make_client()
        await login(admin, (await make_user(RoleEnum.SUPER_ADMIN))["email"], realm="PG")
        faculty = (await _ok(await admin.post(f"{API}/timetable/faculties", json={"id": "ENG", "name": "Engineering"})))["id"]
        department = await _ok(await admin.post(f"{API}/timetable/departments", json={"name": "Civil", "faculty_id": faculty}))
        room = await _ok(await admin.post(f"{API}/timetable/rooms", json={"name": "PG 1", "faculty_id": faculty}))
        session_row = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": "PG 2025/2026"}))
        await _ok(await admin.put(f"{API}/calendar/sessions/{session_row['id']}/current"))
        semester = await _ok(await admin.post(
            f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": session_row["id"]}
        ))
        await _ok(await admin.put(f"{API}/calendar/semesters/{semester['id']}/current"))
        course = await _ok(await admin.post(f"{API}/timetable/courses", json={
            "code": "PG801", "title": "PG Mechanics", "department_id": department["id"], "level": 700,
        }))
        yield {"key": "PG", "admin": admin, "faculty": faculty, "room": room, "semester": semester, "course": course}
    finally:
        async with async_session_maker() as session:
            (await session.get(Realm, "PG")).config = original
            await session.commit()


async def test_a_day_outside_a_realms_list_is_still_refused(weekend_only_pg):
    """ICE now lists every day for lectures; the rule itself is unchanged for a realm that doesn't."""
    pg = weekend_only_pg
    for day in ("Monday", "Thursday"):
        response = await _schedule(pg, _lecture(pg, day_of_week=day))
        assert response.status_code == 400, response.text
        assert response.json()["detail"] == "Postgraduate lectures run on Friday, Saturday, Sunday only"
    item = await _ok(await _schedule(pg, _lecture(pg, day_of_week="Saturday")))
    moved = await pg["admin"].put(f"{API}/timetable/schedule-items/{item['id']}", json={"day_of_week": "Tuesday"})
    assert moved.status_code == 400, moved.text
    blocked = await pg["admin"].post(f"{API}/timetable/blocked-slots", json={
        "name": "Midweek", "day_of_week": "Wednesday", "applies_to": "LECTURE_ONLY", "semester_id": pg["semester"]["id"],
    })
    assert blocked.status_code == 400, blocked.text


# --- Cross-realm room clashes (SPEC 8.2) --------------------------------------
# A clash needs the two realms' rooms to be in one hall group.

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


@pytest.mark.parametrize("day", ["Monday", "Tuesday", "Wednesday", "Thursday"])
@pytest.mark.parametrize("first, second", [("UG", "ICE"), ("ICE", "UG")])
async def test_a_linked_hall_is_checked_against_weekday_lectures_too(campus, day, first, second):
    """UG teaches on weekdays; now that ICE can too, a hall both use can't be double-booked then."""
    holder, late = campus[first], campus[second]
    held = await _ok(await _schedule(holder, _lecture(holder, day_of_week=day, start_time="10:00:00", end_time="12:00:00")))

    response = await _schedule(late, _lecture(late, day_of_week=day, start_time="11:00:00", end_time="13:00:00"))
    assert response.status_code == 409, response.text
    for part in ("ENG 101", f"{first}201", day, "10:00–12:00"):
        assert part in response.json()["detail"], response.json()["detail"]
    # The other realm sees the booking on that weekday, on its own room for the hall.
    [seen] = await _ok(await late["admin"].get(f"{API}/timetable/external-bookings"))
    assert (seen["id"], seen["day_of_week"], seen["room_ids"]) == (held["id"], day, [late["room"]["id"]])

    # Straight after, another weekday, or a room that isn't linked is fine.
    await _ok(await _schedule(late, _lecture(late, day_of_week=day, start_time="12:00:00", end_time="14:00:00")))
    await _ok(await _schedule(late, _lecture(late, day_of_week=day, start_time="11:00:00", end_time="13:00:00", room_ids=[late["unlinked_room"]["id"]])))
    # Moving an existing session onto the held slot is refused as well.
    other_day = "Friday" if day != "Friday" else "Saturday"
    item = await _ok(await _schedule(late, _lecture(late, day_of_week=other_day, start_time="10:30:00", end_time="11:30:00")))
    moved = await late["admin"].put(f"{API}/timetable/schedule-items/{item['id']}", json={"day_of_week": day})
    assert moved.status_code == 409, moved.text


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
    await _ok(await _schedule(ug, _lecture(ug, faculty_id=ug["special"])))
    # The holder is special...
    await _ok(await _schedule(ice, _lecture(ice)))
    # ...and so is the newcomer, against ICE's ordinary booking.
    await _ok(await _schedule(ug, _lecture(ug, faculty_id=ug["special"], start_time="11:00:00", end_time="13:00:00")))


async def test_only_current_semester_items_hold_a_room(campus):
    ug, ice = campus["UG"], campus["ICE"]
    old = await _ok(await _schedule(ug, _lecture(ug)))
    # A new UG session leaves that lecture in a past semester.
    session = await _ok(await ug["admin"].post(f"{API}/calendar/sessions", json={"name": "UG 2026/2027"}))
    await _ok(await ug["admin"].put(f"{API}/calendar/sessions/{session['id']}/current"))
    semester = await _ok(await ug["admin"].post(f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": session["id"]}))
    await _ok(await ug["admin"].put(f"{API}/calendar/semesters/{semester['id']}/current"))

    await _ok(await _schedule(ice, _lecture(ice)))
    assert await _ok(await ice["admin"].get(f"{API}/timetable/external-bookings")) == []
    # Editing the past item isn't checked either: it no longer holds the room.
    await _ok(await ug["admin"].put(f"{API}/timetable/schedule-items/{old['id']}", json={"end_time": "13:00:00"}))


# --- External bookings (SPEC 8.4) ---------------------------------------------

async def test_external_bookings_lists_the_other_realms_current_items(campus, client):
    ug, ice = campus["UG"], campus["ICE"]
    lecture = await _ok(await _schedule(ug, _lecture(ug)))
    exam = await _ok(await _schedule(ug, _exam(ug, faculty_id=ug["special"], room_ids=[ug["other_room"]["id"]])))
    # A booking in a room that is no hall of ICE's is none of ICE's business.
    await _ok(await _schedule(ug, _lecture(ug, day_of_week="Saturday", room_ids=[ug["unlinked_room"]["id"]])))
    mine = await _ok(await _schedule(ice, _lecture(ice, day_of_week="Sunday")))
    url = f"{API}/timetable/external-bookings"

    # Any signed-in user of the realm, with exactly these fields. The rooms are ICE's own rooms for those halls.
    for viewer in (ice["admin"], ice["editor"]):
        assert await _ok(await viewer.get(url)) == [
            {
                "id": lecture["id"], "realm_key": "UG", "realm_name": "Undergraduate", "type": "lecture",
                "room_ids": [ice["room"]["id"]], "day_of_week": "Friday", "exam_date": None,
                "start_time": "10:00:00", "end_time": "12:00:00",
                "course_code": "UG201", "is_special_faculty": False,
            },
            {
                "id": exam["id"], "realm_key": "UG", "realm_name": "Undergraduate", "type": "exam",
                "room_ids": [ice["other_room"]["id"]], "day_of_week": None, "exam_date": SATURDAY,
                "start_time": "10:00:00", "end_time": "13:00:00",
                "course_code": "UG201", "is_special_faculty": True,
            },
        ]

    theirs = await _ok(await ug["editor"].get(url))
    assert [(b["id"], b["realm_key"], b["course_code"]) for b in theirs] == [(mine["id"], "ICE", "ICE201")]

    assert (await client.get(url)).status_code == 401



# --- Hall groups ---------------------------------------------------------------

async def test_rooms_that_are_not_linked_never_clash_across_realms(campus):
    ug, ice = campus["UG"], campus["ICE"]
    # Same name in both realms, same slot, but nothing says they are the same hall.
    for realm in (ug, ice):
        await _ok(await _schedule(realm, _lecture(realm, room_ids=[realm["unlinked_room"]["id"]])))
    for realm in (ug, ice):
        assert await _ok(await realm["admin"].get(f"{API}/timetable/external-bookings")) == []

    # Linking them afterwards makes the bookings visible to each other, and new overlaps are refused.
    await _ok(await _link(ice, ice["unlinked_room"], ug["unlinked_room"]))
    [seen] = await _ok(await ice["admin"].get(f"{API}/timetable/external-bookings"))
    assert (seen["realm_key"], seen["room_ids"]) == ("UG", [ice["unlinked_room"]["id"]])
    late = _lecture(ice, room_ids=[ice["unlinked_room"]["id"]], start_time="11:00:00", end_time="13:00:00")
    assert (await _schedule(ice, late)).status_code == 409


async def test_unlinking_a_room_ends_the_clash_and_leaves_the_other_room_alone(campus):
    ug, ice = campus["UG"], campus["ICE"]
    await _ok(await _schedule(ug, _lecture(ug)))
    assert (await _schedule(ice, _lecture(ice))).status_code == 409

    unlinked = await _ok(await ice["admin"].delete(f"{API}/timetable/rooms/{ice['room']['id']}/hall"))
    assert (unlinked["hall_group_id"], unlinked["linked_rooms"]) == (None, [])
    await _ok(await _schedule(ice, _lecture(ice)))
    assert await _ok(await ice["admin"].get(f"{API}/timetable/external-bookings")) == []

    # UG's room is exactly as it was: same row, still in its group, its session untouched.
    [ug_room] = [r for r in await _ok(await ug["admin"].get(f"{API}/timetable/rooms")) if r["id"] == ug["room"]["id"]]
    assert ug_room["hall_group_id"] is not None and ug_room["linked_rooms"] == []
    assert {k: ug_room[k] for k in ("name", "faculty_id", "is_active")} == {k: ug["room"][k] for k in ("name", "faculty_id", "is_active")}
    assert len(await _ok(await ug["admin"].get(f"{API}/timetable/schedule-items"))) == 1


async def test_a_room_lists_the_other_realms_rooms_for_the_same_hall(campus):
    ug, ice = campus["UG"], campus["ICE"]
    rooms = {r["name"]: r for r in await _ok(await ice["editor"].get(f"{API}/timetable/rooms"))}
    assert rooms["ENG 101"]["realm_key"] == "ICE"
    assert rooms["ENG 101"]["linked_rooms"] == [
        {"room_id": ug["room"]["id"], "name": "ENG 101", "realm_key": "UG", "realm_name": "Undergraduate"},
    ]
    assert rooms["ENG 103"]["linked_rooms"] == [] and rooms["ENG 103"]["hall_group_id"] is None


async def test_a_hall_group_holds_one_room_per_realm(campus):
    ug, ice = campus["UG"], campus["ICE"]
    # ICE's ENG 103 can't join the hall that ICE's ENG 101 is already in...
    response = await _link(ice, ice["unlinked_room"], ug["room"])
    assert response.status_code == 409, response.text
    assert "ENG 101" in response.json()["detail"]
    # ...and a room is never linked to a room of its own realm or to a missing one.
    assert (await _link(ice, ice["unlinked_room"], ice["room"])).status_code == 404
    assert (await _link(ice, ice["unlinked_room"], {"id": 999999})).status_code == 404

    # Moving ICE's ENG 101 to another UG hall leaves UG's old room in its group, on its own.
    moved = await _ok(await _link(ice, ice["room"], ug["unlinked_room"]))
    assert [r["room_id"] for r in moved["linked_rooms"]] == [ug["unlinked_room"]["id"]]
    ug_rooms = {r["id"]: r for r in await _ok(await ug["admin"].get(f"{API}/timetable/rooms"))}
    assert ug_rooms[ug["room"]["id"]]["linked_rooms"] == []
    assert [r["room_id"] for r in ug_rooms[ug["unlinked_room"]["id"]]["linked_rooms"]] == [ice["room"]["id"]]


async def test_only_super_admins_change_hall_groups(campus):
    ug, ice = campus["UG"], campus["ICE"]
    hall = f"{API}/timetable/rooms/{ice['unlinked_room']['id']}/hall"
    assert (await ice["editor"].put(hall, json={"room_id": ug["unlinked_room"]["id"]})).status_code == 403
    assert (await ice["editor"].delete(f"{API}/timetable/rooms/{ice['room']['id']}/hall")).status_code == 403
    assert (await ice["editor"].get(f"{API}/timetable/rooms/other-realm", params={"realm": "UG"})).status_code == 403


async def test_deleting_a_room_is_blocked_only_by_its_own_realms_sessions(campus):
    ug, ice = campus["UG"], campus["ICE"]
    ug_item = await _ok(await _schedule(ug, _lecture(ug)))
    ug_rooms_before = await _ok(await ug["admin"].get(f"{API}/timetable/rooms"))

    # UG's session is in UG's room. ICE's room for the same hall is a different room: it goes.
    await _ok(await ice["admin"].delete(f"{API}/timetable/rooms/{ice['room']['id']}"))
    assert ice["room"]["id"] not in {r["id"] for r in await _ok(await ice["admin"].get(f"{API}/timetable/rooms"))}

    # UG's rooms and session are untouched, apart from the hall no longer having an ICE room.
    ug_rooms = await _ok(await ug["admin"].get(f"{API}/timetable/rooms"))
    assert [{**r, "linked_rooms": []} for r in ug_rooms] == [{**r, "linked_rooms": []} for r in ug_rooms_before]
    assert [r["linked_rooms"] for r in ug_rooms if r["id"] == ug["room"]["id"]] == [[]]
    assert [i["id"] for i in await _ok(await ug["admin"].get(f"{API}/timetable/schedule-items"))] == [ug_item["id"]]

    # A room is held by its own realm's sessions.
    response = await ug["admin"].delete(f"{API}/timetable/rooms/{ug['room']['id']}")
    assert response.status_code == 400, response.text
    await _ok(await ug["admin"].delete(f"{API}/timetable/schedule-items/{ug_item['id']}"))
    await _ok(await ug["admin"].delete(f"{API}/timetable/rooms/{ug['room']['id']}"))


async def test_editing_a_room_never_changes_the_other_realms_room(campus):
    ug, ice = campus["UG"], campus["ICE"]
    before = await _ok(await ug["admin"].get(f"{API}/timetable/rooms"))
    await _ok(await ice["admin"].put(f"{API}/timetable/rooms/{ice['room']['id']}", json={
        "name": "ICE Hall A", "active_seats": 40, "inactive_seats": 5, "is_lab": True, "is_active": False,
    }))
    await _ok(await ice["admin"].post(f"{API}/timetable/rooms/reorder", json={"rooms": [
        {"id": ice["room"]["id"], "display_order": 9}, {"id": ug["other_room"]["id"], "display_order": 9},
    ]}))
    after = await _ok(await ug["admin"].get(f"{API}/timetable/rooms"))
    # Only the name UG shows for the linked ICE room follows the rename.
    assert [{**r, "linked_rooms": []} for r in after] == [{**r, "linked_rooms": []} for r in before]
    assert [l["name"] for r in after if r["id"] == ug["room"]["id"] for l in r["linked_rooms"]] == ["ICE Hall A"]


async def test_room_names_are_unique_per_realm_and_faculty(campus):
    ug, ice = campus["UG"], campus["ICE"]
    for realm in (ug, ice):
        clash = await realm["admin"].post(f"{API}/timetable/rooms", json={"name": "ENG 101", "faculty_id": realm["faculty"]})
        assert clash.status_code == 400, clash.text
        # The same name under another faculty of the realm is allowed, as it always was.
        await _ok(await realm["admin"].post(f"{API}/timetable/rooms", json={"name": "ENG 101", "faculty_id": realm["special"]}))


# --- Adding rooms from Undergraduate ---------------------------------------------

async def _catalogue(client) -> dict:
    return await _ok(await client.get(f"{API}/timetable/rooms/catalogue"))


async def _add(client, *rooms: tuple[int, str | None]):
    return await client.post(f"{API}/timetable/rooms/from-catalogue", json={
        "rooms": [{"room_id": room_id, "faculty_id": faculty_id} for room_id, faculty_id in rooms],
    })


async def test_a_realm_adds_ug_rooms_once_as_rooms_of_its_own(campus, make_client, make_user, login):
    ug, ice = campus["UG"], campus["ICE"]
    auditorium = await _ok(await ug["admin"].post(f"{API}/timetable/rooms", json={
        "name": "Main Auditorium", "faculty_id": ug["faculty"], "active_seats": 400, "inactive_seats": 25, "is_lab": True,
    }))
    annex = await _ok(await ug["admin"].post(f"{API}/timetable/rooms", json={"name": "Annex", "active_seats": 50}))

    # The picker: UG's rooms with name, faculty and capacity, read-only, marking what ICE already has.
    catalogue = await _catalogue(ice["editor"])
    assert (catalogue["realm_key"], catalogue["realm_name"]) == ("UG", "Undergraduate")
    assert [(r["name"], r["faculty_name"], r["capacity"], r["added_room_name"]) for r in catalogue["rooms"]] == [
        ("Annex", None, 50, None),
        ("ENG 101", "Engineering", 0, "ENG 101"),
        ("ENG 102", "Engineering", 0, "ENG 102"),
        ("ENG 103", "Engineering", 0, None),
        ("Main Auditorium", "Engineering", 425, None),
    ]
    assert catalogue["rooms"][1]["added_room_id"] == ice["room"]["id"]

    # One into an ICE faculty, one with no faculty; a missing room and one ICE already has are skipped.
    result = await _ok(await _add(
        ice["admin"], (auditorium["id"], ice["faculty"]), (annex["id"], None), (ug["room"]["id"], ice["faculty"]), (999999, None),
    ))
    assert result["skipped"] == [
        {"room_id": ug["room"]["id"], "name": "ENG 101", "reason": "Already added as 'ENG 101'"},
        {"room_id": 999999, "name": None, "reason": "Room not found"},
    ]
    added = {r["name"]: r for r in result["added"]}
    new = added["Main Auditorium"]
    # Name, capacity, seats and lab flag come from the original; the faculty is ICE's own.
    assert {k: new[k] for k in ("realm_key", "capacity", "active_seats", "inactive_seats", "is_lab", "faculty_id", "is_active")} == {
        "realm_key": "ICE", "capacity": 425, "active_seats": 400, "inactive_seats": 25, "is_lab": True,
        "faculty_id": ice["faculty"], "is_active": True,
    }
    assert new["id"] != auditorium["id"]
    assert added["Annex"]["faculty_id"] is None
    # It is in one hall group with its original...
    assert [(l["realm_key"], l["room_id"]) for l in new["linked_rooms"]] == [("UG", auditorium["id"])]
    assert new["id"] in {r["id"] for r in await _ok(await ice["editor"].get(f"{API}/timetable/rooms"))}
    # ...so the two realms' bookings of it are checked against each other.
    await _ok(await _schedule(ug, _lecture(ug, room_ids=[auditorium["id"]])))
    assert (await _schedule(ice, _lecture(ice, room_ids=[new["id"]]))).status_code == 409

    # Added once: a second try adds nothing, and the picker marks it.
    again = await _ok(await _add(ice["admin"], (auditorium["id"], None)))
    assert again == {"added": [], "skipped": [
        {"room_id": auditorium["id"], "name": "Main Auditorium", "reason": "Already added as 'Main Auditorium'"},
    ]}
    marked = {r["name"]: r["added_room_id"] for r in (await _catalogue(ice["admin"]))["rooms"]}
    assert marked["Main Auditorium"] == new["id"] and marked["ENG 103"] is None

    # UG's rooms were not renamed, moved, duplicated or handed to ICE.
    ug_rooms = {r["name"]: r for r in await _ok(await ug["admin"].get(f"{API}/timetable/rooms"))}
    assert sorted(ug_rooms) == ["Annex", "ENG 101", "ENG 102", "ENG 103", "Main Auditorium"]
    assert {k: ug_rooms["Main Auditorium"][k] for k in ("id", "realm_key", "faculty_id", "capacity")} == {
        "id": auditorium["id"], "realm_key": "UG", "faculty_id": ug["faculty"], "capacity": 425,
    }

    # Later realms do the same: PG adds the same hall, and all three rooms are one hall.
    pg = make_client()
    await login(pg, (await make_user(RoleEnum.SUPER_ADMIN))["email"], realm="PG")
    [pg_room] = (await _ok(await _add(pg, (auditorium["id"], None))))["added"]
    assert [(l["realm_key"], l["room_id"]) for l in pg_room["linked_rooms"]] == [("UG", auditorium["id"]), ("ICE", new["id"])]


async def test_added_rooms_are_edited_and_deleted_without_touching_ug(campus):
    ug, ice = campus["UG"], campus["ICE"]
    # ICE has its own "ENG 103" under Engineering, so this one goes under another ICE faculty.
    [new] = (await _ok(await _add(ice["admin"], (ug["unlinked_room"]["id"], ice["special"]))))["added"]
    before = [{**r, "linked_rooms": []} for r in await _ok(await ug["admin"].get(f"{API}/timetable/rooms"))]

    def ug_rooms_now(rooms):
        return [{**r, "linked_rooms": []} for r in rooms]

    await _ok(await ice["admin"].put(f"{API}/timetable/rooms/{new['id']}", json={
        "name": "ICE Lab 3", "active_seats": 20, "inactive_seats": 0, "is_active": False,
    }))
    assert ug_rooms_now(await _ok(await ug["admin"].get(f"{API}/timetable/rooms"))) == before
    # UG's own change stays in UG.
    await _ok(await ug["admin"].put(f"{API}/timetable/rooms/{ug['unlinked_room']['id']}", json={"name": "ENG 103 (new wing)", "active_seats": 500}))
    [mine] = [r for r in await _ok(await ice["admin"].get(f"{API}/timetable/rooms")) if r["id"] == new["id"]]
    assert (mine["name"], mine["capacity"], mine["is_active"]) == ("ICE Lab 3", 20, False)

    await _ok(await ice["admin"].delete(f"{API}/timetable/rooms/{new['id']}"))
    ug_rooms = await _ok(await ug["admin"].get(f"{API}/timetable/rooms"))
    assert len(ug_rooms) == len(before)
    assert [r["name"] for r in ug_rooms if r["id"] == ug["unlinked_room"]["id"]] == ["ENG 103 (new wing)"]
    # Having deleted it, ICE can add that hall again.
    assert len((await _ok(await _add(ice["admin"], (ug["unlinked_room"]["id"], None))))["added"]) == 1


async def test_adding_follows_the_rules_for_creating_a_room(campus, make_client, make_user, login):
    ug, ice = campus["UG"], campus["ICE"]
    room_id = ug["unlinked_room"]["id"]

    # A faculty editor adds rooms to their own faculty only.
    assert (await _add(ice["editor"], (room_id, None))).status_code == 403
    assert (await _add(ice["editor"], (room_id, ice["special"]))).status_code == 403
    # Nobody binds a room to another realm's faculty, or to one that doesn't exist.
    for faculty in (ug["faculty"], "NOPE"):
        response = await _add(ice["admin"], (room_id, faculty))
        assert (response.status_code, response.json()) == (404, {"detail": "Faculty not found"})
    # A name already used in that ICE faculty is skipped, not duplicated.
    await _ok(await ice["admin"].post(f"{API}/timetable/rooms", json={"name": "ENG 103", "faculty_id": ice["special"]}))
    clash = await _ok(await _add(ice["admin"], (room_id, ice["special"])))
    assert clash == {"added": [], "skipped": [
        {"room_id": room_id, "name": "ENG 103", "reason": "A room with this name already exists in that faculty"},
    ]}
    assert len((await _ok(await _add(ice["editor"], (room_id, ice["faculty"]))))["added"]) == 0  # ICE's ENG 103 exists there too

    # General Studies admins add rooms with no faculty; viewers and DEOs can't open the picker at all.
    gs = make_client()
    await login(gs, (await make_user(RoleEnum.GS_ADMIN, realm="ICE"))["email"])
    assert (await _add(gs, (room_id, ice["faculty"]))).status_code == 403
    assert len((await _ok(await _add(gs, (room_id, None))))["added"]) == 1
    for role in (RoleEnum.FACULTY_VIEWER, RoleEnum.DEO, RoleEnum.SUPER_VIEWER):
        viewer = make_client()
        await login(viewer, (await make_user(role, faculty_id=ice["faculty"], realm="ICE"))["email"], realm="ICE")
        assert (await viewer.get(f"{API}/timetable/rooms/catalogue")).status_code == 403
        assert (await _add(viewer, (room_id, None))).status_code == 403
        # Outside the picker, another realm's rooms are never listed.
        assert {r["realm_key"] for r in await _ok(await viewer.get(f"{API}/timetable/rooms", params={"all": "true"}))} == {"ICE"}

    # Undergraduate is the catalogue: it has nothing to pick from.
    assert (await _catalogue(ug["admin"]))["rooms"] == []
    assert (await _add(ug["admin"], (ice["room"]["id"], None))).status_code == 400

