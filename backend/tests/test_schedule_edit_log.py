"""A schedule item edit is logged with what it replaced, so the activity log
shows the move (Monday to Wednesday), not just where the item ended up."""
from tests.test_hod_role import API, _logs, _ok, campus, invitation_emails, sent_emails  # noqa: F401


async def test_an_edit_records_the_old_values_and_reads_as_a_move(campus):
    ug = campus["UG"]
    item = ug["eng_item"]
    other_room = await _ok(await ug["admin"].post(
        f"{API}/timetable/rooms", json={"name": "ENG 202", "faculty_id": ug["eng"]["id"]}
    ))
    await _ok(await ug["admin"].put(f"{API}/timetable/schedule-items/{item['id']}", json={
        "day_of_week": "Wednesday", "start_time": "14:00:00", "end_time": "16:00:00",
        "room_ids": [other_room["id"]],
    }))
    entry = (await _logs("schedule_item.lecture.update"))[-1]
    assert entry.description == (
        "Moved lecture for ENG201 from Monday 10:00-12:00 to Wednesday 14:00-16:00; venue ENG 101 to ENG 202"
    )
    assert entry.extra["before"] == {
        "day_of_week": "Monday", "start_time": "10:00:00", "end_time": "12:00:00", "room_ids": [ug["eng_room"]["id"]],
    }
    assert entry.extra["day_of_week"] == "Wednesday"
    assert entry.extra["semester_id"] == ug["semester"]["id"]
    assert entry.extra["course_code"] == "ENG201"


async def test_an_edit_that_changes_nothing_records_no_old_values(campus):
    ug = campus["UG"]
    item = ug["eng_item"]
    await _ok(await ug["admin"].put(f"{API}/timetable/schedule-items/{item['id']}", json={"day_of_week": "Monday"}))
    entry = (await _logs("schedule_item.lecture.update"))[-1]
    assert entry.description == "Updated lecture for ENG201"
    assert entry.extra["before"] == {}
