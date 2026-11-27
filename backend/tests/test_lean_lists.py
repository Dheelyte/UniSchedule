"""GET /courses and GET /schedule-items are built from plain rows instead of ORM
objects and response models (to fit the Lambda's memory). They must send exactly
what the model-based version did: same items, same order, same fields and values."""
from pydantic import TypeAdapter

from core.database import async_session_maker
from modules.auth.models import RoleEnum
from modules.timetable.repository import TimetableRepository
from modules.timetable.schemas import CourseResponse, ScheduleItemResponse
from tests.test_hod_role import API, _lecture, _ok, _staff, campus, invitation_emails, sent_emails  # noqa: F401

COURSES = TypeAdapter(list[CourseResponse])
ITEMS = TypeAdapter(list[ScheduleItemResponse])


async def _model_courses(**kwargs) -> list:
    async with async_session_maker() as session:
        courses = await TimetableRepository(session).get_courses(**kwargs)
        return COURSES.dump_python(COURSES.validate_python(courses, from_attributes=True), mode="json")


async def _model_items(**kwargs) -> list:
    async with async_session_maker() as session:
        items = await TimetableRepository(session).get_schedule_items(**kwargs)
        return ITEMS.dump_python(ITEMS.validate_python(items, from_attributes=True), mode="json")


async def test_lists_match_the_model_based_version(campus, make_client, make_user, login):
    ug = campus["UG"]
    admin = ug["admin"]
    # Some variety: an exam, an online lecture, a course with lecturers and no level.
    await _ok(await admin.post(f"{API}/timetable/schedule-items", json=_lecture(
        ug, "sci", type="exam", day_of_week=None, exam_date="2026-12-04", week=2, start_time="09:00:00", end_time="11:00:00",
    )))
    await _ok(await admin.post(f"{API}/timetable/schedule-items", json=_lecture(ug, "eng", is_online=True, room_ids=[], start_time="14:00:00", end_time="16:00:00")))
    await _ok(await admin.post(f"{API}/timetable/courses", json={
        "code": "GST101", "title": "Use of English", "department_id": ug["eng_department"]["id"],
        "scope": "UNIVERSITY_WIDE", "lecturers": ["Dr A", "Prof B"], "is_cbt_exam": True,
    }))

    assert (await admin.get(f"{API}/timetable/courses")).json() == await _model_courses(realm_key="UG")
    for params, kwargs in (
        ({}, {}),
        ({"type": "exam"}, {"item_type": "exam"}),
        ({"semester_id": ug["semester"]["id"], "type": "lecture"}, {"semester_id": ug["semester"]["id"], "item_type": "lecture"}),
    ):
        response = await admin.get(f"{API}/timetable/schedule-items", params=params)
        assert response.headers["content-type"] == "application/json"
        assert response.json() == await _model_items(realm_key="UG", **kwargs)

    # Every role reads the whole realm; an editor's own faculty's courses come first.
    editor, _ = await _staff(make_client, make_user, login, RoleEnum.FACULTY_EDITOR, ug, "sci")
    sci = ug["sci"]["id"]
    courses = (await editor.get(f"{API}/timetable/courses")).json()
    assert courses == await _model_courses(realm_key="UG", prioritize_faculty_id=sci)
    assert courses[0]["code"] == "SCI201"
    assert (await editor.get(f"{API}/timetable/schedule-items")).json() == await _model_items(realm_key="UG")

    # The faculty-narrowed queries give the same rows as the ORM versions.
    async with async_session_maker() as session:
        repo = TimetableRepository(session)
        rows = await repo.course_rows(realm_key="UG", faculty_id=sci, prioritize_faculty_id=sci)
        assert COURSES.dump_python(COURSES.validate_python(rows), mode="json") == await _model_courses(realm_key="UG", faculty_id=sci, prioritize_faculty_id=sci)
        rows = await repo.schedule_item_rows(realm_key="UG", faculty_id=sci)
        assert ITEMS.dump_python(ITEMS.validate_python(rows), mode="json") == await _model_items(realm_key="UG", faculty_id=sci)
        assert {r["faculty_id"] for r in rows} == {sci}

    # Another realm's rows never appear.
    ice_codes = {c["code"] for c in (await campus["ICE"]["admin"].get(f"{API}/timetable/courses")).json()}
    assert ice_codes == {"ENG201"} and "GST101" not in ice_codes
