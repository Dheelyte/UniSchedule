"""Importing a faculty timetable from a workbook: questions, checks, replace and add."""
import io
import json

import openpyxl
import pytest

from modules.auth.models import RoleEnum

API = "/api/v1"


async def _ok(response, status: int = 200):
    assert response.status_code == status, response.text
    return response.json() if response.content else None


def _workbook(rows) -> bytes:
    wb = openpyxl.Workbook()
    for r, row in enumerate(rows, start=1):
        for c, value in enumerate(row, start=1):
            if value is not None:
                wb.active.cell(r, c, value)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


LECTURES = _workbook([
    ["FACULTY OF ENGINEERING"],
    ["MONDAY"],
    ["Venue", "Faculty", "8-9am", "9-10am", "10-11am"],
    ["Room 101", "ENG", "CVE 201", "CVE 201", "CVE 202/203"],
    ["Hall Z", "ENG", "XYZ 999", None, None],
])

WEDNESDAY_LECTURES = _workbook([
    ["WEDNESDAY"],
    ["Venue", "8-9am", "9-10am"],
    ["RM 101", "CVE 203", "CVE 203"],
])

EXAMS = _workbook([
    ["VENUE", "DAY 1: MONDAY", None, "DAY 2: TUESDAY"],
    ["TIME", "9am - 12pm", "12pm - 3pm", "9am - 12pm"],
    ["RM 101", "CVE 201", "CVE 202", "CVE 203"],
    ["RM 102", "CVE 201", None, None],
    ["VENUE", "DAY 3: MONDAY"],
    ["TIME", "9am - 12pm"],
    ["RM 101", "CVE 202"],
])


async def _send(client, action: str, content: bytes, **options):
    return await client.post(
        f"{API}/timetable-import/{action}",
        files={"file": ("timetable.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"options": json.dumps(options)},
    )


@pytest.fixture
async def faculty(make_client, make_user, login) -> dict:
    admin = make_client()
    await login(admin, (await make_user(RoleEnum.SUPER_ADMIN))["email"])
    for fid, name in (("ENG", "Engineering"), ("SCI", "Science"), ("GS", "General Studies")):
        await _ok(await admin.post(f"{API}/timetable/faculties", json={"id": fid, "name": name}))
    department = await _ok(await admin.post(f"{API}/timetable/departments", json={"name": "Civil", "faculty_id": "ENG"}))
    rooms = {
        name: await _ok(await admin.post(f"{API}/timetable/rooms", json={"name": name, "faculty_id": "ENG", "active_seats": 100}))
        for name in ("RM 101", "RM 102", "Hall A")
    }
    courses = {
        code: await _ok(await admin.post(f"{API}/timetable/courses", json={
            "code": code, "title": code, "department_id": department["id"], "level": 200,
        }))
        for code in ("CVE201", "CVE202", "CVE203", "PHY101", "GST111")
    }
    session = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": "2026/2027"}))
    await _ok(await admin.put(f"{API}/calendar/sessions/{session['id']}/current"))
    semester = await _ok(await admin.post(f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": session["id"]}))
    semester = await _ok(await admin.put(f"{API}/calendar/semesters/{semester['id']}/current"))
    return {"admin": admin, "rooms": rooms, "courses": courses, "semester": semester}


async def _items(faculty, item_type="lecture"):
    """The current semester's sessions of this type."""
    items = await _ok(await faculty["admin"].get(f"{API}/timetable/schedule-items"))
    return [i for i in items if i["type"] == item_type and i["semester_id"] == faculty["semester"]["id"]]


async def test_only_super_admins_can_import(make_client, make_user, login, faculty):
    editor = make_client()
    await login(editor, (await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG"))["email"])
    response = await _send(editor, "preview", LECTURES, faculty_id="ENG", item_type="lecture")
    assert response.status_code == 403


async def test_preview_asks_about_unknown_codes_and_venues(faculty):
    preview = await _ok(await _send(faculty["admin"], "preview", LECTURES, faculty_id="ENG", item_type="lecture"))
    assert not preview["ready"]
    assert [q["code"] for q in preview["questions"]["courses"]] == ["XYZ999"]
    assert [q["text"] for q in preview["questions"]["venues"]] == ["Hall Z"]
    assert [s["name"] for s in preview["questions"]["venues"][0]["suggestions"]] == ["Hall A"]
    # "Room 101" is RM 101; CVE 201 over two hours is one session; CVE 202/203 share a cell.
    assert [(i["code"], i["start_time"], i["end_time"], i["room_ids"]) for i in preview["items"]] == [
        ("CVE201", "08:00:00", "10:00:00", [faculty["rooms"]["RM 101"]["id"]]),
        ("CVE202", "10:00:00", "11:00:00", [faculty["rooms"]["RM 101"]["id"]]),
        ("CVE203", "10:00:00", "11:00:00", [faculty["rooms"]["RM 101"]["id"]]),
    ]
    assert all(not i["warnings"] for i in preview["items"])

    response = await _send(faculty["admin"], "apply", LECTURES, faculty_id="ENG", item_type="lecture")
    assert response.status_code == 400


async def test_answers_are_applied_and_replace_keeps_other_faculties(faculty):
    admin, rooms, courses = faculty["admin"], faculty["rooms"], faculty["courses"]
    for fid, course in (("ENG", "PHY101"), ("SCI", "PHY101")):
        await _ok(await admin.post(f"{API}/timetable/schedule-items", json={
            "course_id": courses[course]["id"], "room_ids": [rooms["RM 102"]["id"]], "faculty_id": fid,
            "day_of_week": "Tuesday" if fid == "ENG" else "Wednesday",
            "start_time": "08:00:00", "end_time": "10:00:00", "type": "lecture",
        }))
    answers = {"courses": {"XYZ999": courses["PHY101"]["id"]}, "venues": {"Hall Z": [rooms["Hall A"]["id"]]}}

    preview = await _ok(await _send(admin, "preview", LECTURES, faculty_id="ENG", item_type="lecture", answers=answers))
    assert preview["ready"]
    assert preview["diff"]["current_count"] == 1

    result = await _ok(await _send(admin, "apply", LECTURES, faculty_id="ENG", item_type="lecture", answers=answers))
    assert (result["created"], result["removed"], result["left_out"]) == (4, 1, 0)
    items = await _items(faculty)
    assert sorted((i["faculty_id"], i["day_of_week"]) for i in items) == [
        ("ENG", "Monday"), ("ENG", "Monday"), ("ENG", "Monday"), ("ENG", "Monday"), ("SCI", "Wednesday"),
    ]
    logs = await _ok(await admin.get(f"{API}/audit/logs"))
    entries = logs["items"] if isinstance(logs, dict) else logs
    assert any(e["action"] == "schedule_item.lecture.import" for e in entries)

    # Adding keeps what is there.
    result = await _ok(await _send(admin, "apply", LECTURES, faculty_id="ENG", item_type="lecture", mode="add", answers=answers))
    assert result["removed"] == 0
    assert len(await _items(faculty)) == 9


async def test_room_clash_with_another_faculty_is_a_warning(faculty):
    admin, rooms, courses = faculty["admin"], faculty["rooms"], faculty["courses"]
    await _ok(await admin.post(f"{API}/timetable/schedule-items", json={
        "course_id": courses["PHY101"]["id"], "room_ids": [rooms["RM 101"]["id"]], "faculty_id": "SCI",
        "day_of_week": "Monday", "start_time": "09:00:00", "end_time": "10:00:00", "type": "lecture",
    }))
    preview = await _ok(await _send(admin, "preview", LECTURES, faculty_id="ENG", item_type="lecture"))
    cve201 = next(i for i in preview["items"] if i["code"] == "CVE201")
    assert cve201["warnings"] == ["Room clash with PHY101 (Science)"]
    assert not cve201["blocking"]


async def test_blocked_slot_stops_the_import_unless_left_out(faculty):
    admin = faculty["admin"]
    await _ok(await admin.post(f"{API}/timetable/blocked-slots", json={
        "name": "Assembly", "day_of_week": "Monday", "start_time": "10:00:00", "end_time": "11:00:00",
        "semester_id": faculty["semester"]["id"],
    }))
    answers = {"courses": {"XYZ999": None}, "venues": {"Hall Z": []}}
    preview = await _ok(await _send(admin, "preview", LECTURES, faculty_id="ENG", item_type="lecture", answers=answers))
    assert preview["blocking_count"] == 2
    assert (await _send(admin, "apply", LECTURES, faculty_id="ENG", item_type="lecture", answers=answers)).status_code == 400

    result = await _ok(await _send(
        admin, "apply", LECTURES, faculty_id="ENG", item_type="lecture", answers=answers, skip_blocked=True,
    ))
    assert (result["created"], result["removed"], result["left_out"]) == (1, 0, 2)


async def test_exam_days_without_dates_ask_for_the_first_exam_date(faculty):
    admin, rooms = faculty["admin"], faculty["rooms"]
    preview = await _ok(await _send(admin, "preview", EXAMS, faculty_id="ENG", item_type="exam"))
    assert preview["questions"]["exam_start_date"]
    assert preview["items"] == []

    answers = {"exam_start_date": "2026-08-10"}
    preview = await _ok(await _send(admin, "preview", EXAMS, faculty_id="ENG", item_type="exam", answers=answers))
    assert preview["ready"]
    assert [(i["code"], i["exam_date"], i["week"], i["room_ids"]) for i in preview["items"]] == [
        ("CVE201", "2026-08-10", 1, [rooms["RM 101"]["id"], rooms["RM 102"]["id"]]),
        ("CVE202", "2026-08-10", 1, [rooms["RM 101"]["id"]]),
        ("CVE203", "2026-08-11", 1, [rooms["RM 101"]["id"]]),
        ("CVE202", "2026-08-17", 2, [rooms["RM 101"]["id"]]),
    ]
    # Exams can share a hall, so RM 101 holding two papers at once isn't a clash.
    assert preview["warning_count"] == 0

    await _ok(await _send(admin, "apply", EXAMS, faculty_id="ENG", item_type="exam", answers=answers))
    exams = await _items(faculty, "exam")
    assert sorted(e["exam_date"] for e in exams) == ["2026-08-10", "2026-08-10", "2026-08-11", "2026-08-17"]
    assert all(e["day_of_week"] is None for e in exams)


async def test_a_file_that_is_not_a_workbook_is_refused(faculty):
    response = await _send(faculty["admin"], "preview", b"not a spreadsheet", faculty_id="ENG", item_type="lecture")
    assert response.status_code == 400


async def _imported(faculty):
    """Engineering with one existing lecture, then the file imported over it."""
    admin, rooms, courses = faculty["admin"], faculty["rooms"], faculty["courses"]
    await _ok(await admin.post(f"{API}/timetable/schedule-items", json={
        "course_id": courses["PHY101"]["id"], "room_ids": [rooms["RM 102"]["id"]], "faculty_id": "ENG",
        "day_of_week": "Tuesday", "start_time": "08:00:00", "end_time": "10:00:00", "type": "lecture",
    }))
    answers = {"courses": {"XYZ999": None}, "venues": {"Hall Z": []}}
    return await _ok(await _send(admin, "apply", LECTURES, faculty_id="ENG", item_type="lecture", answers=answers))


async def _revert(client, import_id):
    return await client.post(f"{API}/timetable-import/imports/{import_id}/revert")


async def test_revert_puts_the_old_timetable_back_at_any_time(faculty):
    result = await _imported(faculty)
    assert sorted(i["day_of_week"] for i in await _items(faculty)) == ["Monday"] * 3

    reverted = await _ok(await _revert(faculty["admin"], result["import_id"]))
    assert reverted == {"removed": 3, "restored": 1}
    items = await _items(faculty)
    assert [(i["course_id"], i["day_of_week"], i["start_time"], i["room_ids"]) for i in items] == [
        (faculty["courses"]["PHY101"]["id"], "Tuesday", "08:00:00", [faculty["rooms"]["RM 102"]["id"]]),
    ]
    assert (await _revert(faculty["admin"], result["import_id"])).status_code == 409


async def test_imports_are_listed_with_what_they_did(faculty):
    result = await _imported(faculty)
    imports = await _ok(await faculty["admin"].get(f"{API}/timetable-import/imports"))
    assert [(i["id"], i["faculty_name"], i["item_type"], i["mode"], i["created_count"], i["still_present"],
             i["replaced_count"], i["can_revert"], i["would_restore"]) for i in imports] == [
        (result["import_id"], "Engineering", "lecture", "replace", 3, 3, 1, True, True),
    ]
    assert imports[0]["file_name"] == "timetable.xlsx"
    assert imports[0]["created_by_email"]

    await _ok(await _revert(faculty["admin"], result["import_id"]))
    imports = await _ok(await faculty["admin"].get(f"{API}/timetable-import/imports?item_type=lecture"))
    assert (imports[0]["can_revert"], imports[0]["still_present"], imports[0]["restored_count"]) == (False, 0, 1)
    assert imports[0]["reverted_by_email"]
    assert await _ok(await faculty["admin"].get(f"{API}/timetable-import/imports?item_type=exam")) == []


async def test_reverting_an_older_import_leaves_a_newer_one_alone(faculty):
    answers = {"courses": {"XYZ999": None}, "venues": {"Hall Z": []}}
    first = await _imported(faculty)
    second = await _ok(await _send(faculty["admin"], "apply", WEDNESDAY_LECTURES, faculty_id="ENG", item_type="lecture", answers=answers))
    newer = sorted((i["course_id"], i["day_of_week"]) for i in await _items(faculty))

    # The first import's sessions were already replaced, and putting back what it
    # replaced would land the old timetable on top of the newer one.
    imports = await _ok(await faculty["admin"].get(f"{API}/timetable-import/imports"))
    assert {i["id"]: (i["still_present"], i["would_restore"]) for i in imports}[first["import_id"]] == (0, False)
    assert await _ok(await _revert(faculty["admin"], first["import_id"])) == {"removed": 0, "restored": 0}
    assert sorted((i["course_id"], i["day_of_week"]) for i in await _items(faculty)) == newer
    assert second["created"] == 1


async def test_reverting_newest_first_walks_back_to_the_start(faculty):
    answers = {"courses": {"XYZ999": None}, "venues": {"Hall Z": []}}
    first = await _imported(faculty)
    second = await _ok(await _send(faculty["admin"], "apply", WEDNESDAY_LECTURES, faculty_id="ENG", item_type="lecture", answers=answers))

    assert await _ok(await _revert(faculty["admin"], second["import_id"])) == {"removed": 1, "restored": 3}
    assert sorted(i["day_of_week"] for i in await _items(faculty)) == ["Monday"] * 3
    # The first import still finds its sessions, though they were put back under new ids.
    assert await _ok(await _revert(faculty["admin"], first["import_id"])) == {"removed": 3, "restored": 1}
    assert [i["day_of_week"] for i in await _items(faculty)] == ["Tuesday"]


async def test_any_super_admin_can_revert(faculty, make_client, make_user, login):
    result = await _imported(faculty)
    other = make_client()
    await login(other, (await make_user(RoleEnum.SUPER_ADMIN))["email"])
    assert (await _revert(other, result["import_id"])).status_code == 200


async def test_an_import_from_another_realm_is_not_found(faculty, make_client, make_user, login):
    result = await _imported(faculty)
    ice = make_client()
    await login(ice, (await make_user(RoleEnum.SUPER_ADMIN))["email"], realm="ICE")
    assert (await _revert(ice, result["import_id"])).status_code == 404
    assert await _ok(await ice.get(f"{API}/timetable-import/imports")) == []


async def test_answers_naming_another_realms_room_or_course_are_not_found(faculty, make_client, make_user, login):
    ice = make_client()
    await login(ice, (await make_user(RoleEnum.SUPER_ADMIN))["email"], realm="ICE")
    await _ok(await ice.post(f"{API}/timetable/faculties", json={"id": "ICE-ENG", "name": "Engineering"}))
    ice_room = await _ok(await ice.post(f"{API}/timetable/rooms", json={"name": "Hall Z", "active_seats": 50}))

    for answers in ({"venues": {"Hall Z": [ice_room["id"]]}}, {"courses": {"XYZ999": 999999}}):
        response = await _send(faculty["admin"], "preview", LECTURES, faculty_id="ENG", item_type="lecture", answers=answers)
        assert response.status_code == 404, response.text


async def test_a_workbook_that_unpacks_too_large_is_refused(faculty, monkeypatch):
    from modules.timetable_import import reader
    monkeypatch.setattr(reader, "MAX_UNPACKED_BYTES", 1000)
    response = await _send(faculty["admin"], "preview", LECTURES, faculty_id="ENG", item_type="lecture")
    assert response.status_code == 413



GST_LECTURES = _workbook([
    ["FRIDAY"],
    ["Venue", "2-3pm", "3-4pm", "4-5pm"],
    ["RM 101", None, "GST 111", "GST 111"],
])


async def _faculty_sessions(faculty, code):
    course_id = faculty["courses"][code]["id"]
    return sorted((i["faculty_id"], i["day_of_week"], i["start_time"]) for i in await _items(faculty) if i["course_id"] == course_id)


async def test_general_studies_lectures_are_placed_in_every_faculty(faculty):
    admin = faculty["admin"]
    preview = await _ok(await _send(admin, "preview", GST_LECTURES, faculty_id="GS", item_type="lecture", place_in_faculties=True))
    assert preview["faculty_count"] == 3
    assert [(i["code"], i["faculty_count"]) for i in preview["items"]] == [("GST111", 3)]

    result = await _ok(await _send(admin, "apply", GST_LECTURES, faculty_id="GS", item_type="lecture", place_in_faculties=True))
    assert result["created"] == 3
    assert await _faculty_sessions(faculty, "GST111") == [
        ("ENG", "Friday", "15:00:00"), ("GS", "Friday", "15:00:00"), ("SCI", "Friday", "15:00:00"),
    ]

    # Importing it again replaces every faculty's copy rather than doubling them.
    again = await _ok(await _send(admin, "apply", GST_LECTURES, faculty_id="GS", item_type="lecture", place_in_faculties=True))
    assert (again["created"], again["removed"]) == (3, 3)
    assert len(await _faculty_sessions(faculty, "GST111")) == 3

    imports = await _ok(await admin.get(f"{API}/timetable-import/imports"))
    assert imports[0]["place_in_faculties"] is True


async def test_a_faculty_import_leaves_general_studies_copies_alone(faculty):
    admin = faculty["admin"]
    await _ok(await _send(admin, "apply", GST_LECTURES, faculty_id="GS", item_type="lecture", place_in_faculties=True))
    eng_file = _workbook([
        ["MONDAY"],
        ["Venue", "8-9am", "9-10am"],
        ["RM 101", "CVE 201", "GST 111"],
    ])

    preview = await _ok(await _send(admin, "preview", eng_file, faculty_id="ENG", item_type="lecture"))
    assert [i["code"] for i in preview["items"]] == ["CVE201"]
    assert preview["shared_courses"] == [{"code": "GST111", "count": 1}]
    assert preview["diff"]["current_count"] == 0

    await _ok(await _send(admin, "apply", eng_file, faculty_id="ENG", item_type="lecture"))
    assert ("ENG", "Friday", "15:00:00") in await _faculty_sessions(faculty, "GST111")


async def test_reverting_a_general_studies_import_puts_each_faculty_copy_back(faculty):
    admin = faculty["admin"]
    await _ok(await _send(admin, "apply", GST_LECTURES, faculty_id="GS", item_type="lecture", place_in_faculties=True))
    moved = _workbook([["TUESDAY"], ["Venue", "8-9am", "9-10am"], ["RM 102", "GST 111", "GST 111"]])
    second = await _ok(await _send(admin, "apply", moved, faculty_id="GS", item_type="lecture", place_in_faculties=True))
    assert {d for _, d, _ in await _faculty_sessions(faculty, "GST111")} == {"Tuesday"}

    await _ok(await _revert(admin, second["import_id"]))
    assert await _faculty_sessions(faculty, "GST111") == [
        ("ENG", "Friday", "15:00:00"), ("GS", "Friday", "15:00:00"), ("SCI", "Friday", "15:00:00"),
    ]


def _docx(rows, merged_down=()) -> bytes:
    """A Word document holding one table. `merged_down` lists (row, col) cells that continue the cell above."""
    import zipfile
    from xml.sax.saxutils import escape

    def cell(r, c, text):
        props = ""
        if (r, c) in merged_down:
            props = '<w:tcPr><w:vMerge w:val="continue"/></w:tcPr>'
            text = ""
        elif any((r2, c) in merged_down for r2 in range(r + 1, len(rows))):
            props = '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>'
        paragraphs = "".join(f"<w:p><w:r><w:t>{escape(line)}</w:t></w:r></w:p>" for line in str(text).split("\n"))
        return f"<w:tc>{props}{paragraphs}</w:tc>"

    body = "".join("<w:tr>" + "".join(cell(r, c, t) for c, t in enumerate(row)) + "</w:tr>" for r, row in enumerate(rows))
    document = (
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        f"<w:p><w:r><w:t>CENTRE FOR GENERAL STUDIES</w:t></w:r></w:p><w:tbl>{body}</w:tbl></w:body></w:document>"
    )
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", document)
    return out.getvalue()


async def _send_docx(client, action, content, **options):
    return await client.post(
        f"{API}/timetable-import/{action}",
        files={"file": ("gst.docx", content, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        data={"options": json.dumps(options)},
    )


GST_EXAMS = _docx([
    ["DAY", "FACULTY", "TIME", "GST COURSE(S)", "VENUE"],
    ["Monday, 10 August 2026", "Engineering\n(Physically Challenged Student)", "8.00am – 12.00pm", "GST111", "RM 101"],
    ["Monday, 10 August 2026", "Sciences", "8.00am – 12.00pm", "GST111", "RM 102"],
    ["Tuesday, 11 August 2026", "Science", "8.00am – 12.00pm", "GST111", "RM 102"],
], merged_down={(2, 0)})


async def test_general_studies_exams_go_to_the_faculties_each_row_names(faculty):
    admin, rooms = faculty["admin"], faculty["rooms"]
    preview = await _ok(await _send_docx(admin, "preview", GST_EXAMS, faculty_id="GS", item_type="exam", place_in_faculties=True))
    assert preview["faculty_notes"] == ["(Physically Challenged Student)"]
    assert [(i["exam_date"], i["room_ids"], i["faculties"]) for i in preview["items"]] == [
        ("2026-08-10", [rooms["RM 101"]["id"]], ["Engineering"]),
        ("2026-08-10", [rooms["RM 102"]["id"]], ["Science"]),
        ("2026-08-11", [rooms["RM 102"]["id"]], ["Science"]),
    ]
    # Every faculty on Monday, and Science twice: both are flagged, neither blocks.
    monday = preview["items"][0]["warnings"]
    assert "Every faculty sits GST111 on the same day" in monday
    assert any("Science sits GST111 more than once" in w for w in preview["items"][2]["warnings"])
    assert preview["blocking_count"] == 0

    await _ok(await _send_docx(admin, "apply", GST_EXAMS, faculty_id="GS", item_type="exam", place_in_faculties=True))
    course_id = faculty["courses"]["GST111"]["id"]
    exams = [(e["faculty_id"], e["exam_date"]) for e in await _items(faculty, "exam") if e["course_id"] == course_id]
    assert sorted(exams) == [
        ("ENG", "2026-08-10"), ("GS", "2026-08-10"), ("GS", "2026-08-10"), ("GS", "2026-08-11"),
        ("SCI", "2026-08-10"), ("SCI", "2026-08-11"),
    ]


async def test_an_unknown_faculty_is_a_question(faculty):
    unknown = _docx([
        ["DAY", "FACULTY", "TIME", "GST COURSE(S)", "VENUE"],
        ["Monday, 10 August 2026", "Agriculture", "8.00am – 12.00pm", "GST111", "RM 101"],
    ])
    preview = await _ok(await _send_docx(faculty["admin"], "preview", unknown, faculty_id="GS", item_type="exam", place_in_faculties=True))
    assert [q["text"] for q in preview["questions"]["faculties"]] == ["Agriculture"]
    assert not preview["ready"]

    answered = await _ok(await _send_docx(
        faculty["admin"], "preview", unknown, faculty_id="GS", item_type="exam", place_in_faculties=True,
        answers={"faculties": {"Agriculture": "SCI"}},
    ))
    assert answered["ready"] and answered["items"][0]["faculties"] == ["Science"]


# --- Copying from an earlier semester -------------------------------------------

@pytest.fixture
async def last_year(faculty) -> dict:
    """An earlier session with a First Semester timetable, while a new session's First Semester is current."""
    admin, rooms, courses = faculty["admin"], faculty["rooms"], faculty["courses"]
    old_session = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": "2025/2026"}))
    # Semesters are added to the current session only.
    await _ok(await admin.put(f"{API}/calendar/sessions/{old_session['id']}/current"))
    old = await _ok(await admin.post(f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": old_session["id"]}))
    from core.database import async_session_maker
    from modules.timetable.models import ScheduleItem
    from datetime import date, time
    async with async_session_maker() as db:
        def item(course, fac, **kw):
            return ScheduleItem(course_id=courses[course]["id"], faculty_id=fac, semester_id=old["id"], realm_key="UG", **kw)
        db.add_all([
            item("CVE201", "ENG", room_ids=[rooms["RM 101"]["id"]], type="lecture", day_of_week="Monday", start_time=time(8), end_time=time(10)),
            item("PHY101", "SCI", room_ids=[rooms["RM 102"]["id"]], type="lecture", day_of_week="Tuesday", start_time=time(9), end_time=time(11)),
            item("CVE202", "ENG", room_ids=[rooms["RM 101"]["id"]], type="exam", exam_date=date(2026, 3, 4), start_time=time(9), end_time=time(12)),
            item("CVE203", "ENG", room_ids=[rooms["RM 101"]["id"]], type="exam", exam_date=date(2026, 3, 9), start_time=time(9), end_time=time(12)),
        ])
        # Switch back: the new session's semester stays the one being scheduled.
        from sqlalchemy import text
        current = faculty["semester"]
        await db.execute(text("UPDATE semesters SET is_current = (id = :id)"), {"id": current["id"]})
        # One current session per realm: clear first, then set.
        await db.execute(text("UPDATE academic_sessions SET is_current = false"))
        await db.execute(text("UPDATE academic_sessions SET is_current = true WHERE id = :id"), {"id": current["session_id"]})
        await db.commit()
    return {**faculty, "old": old}


async def _copy(client, action, **options):
    return await client.post(f"{API}/timetable-import/copy/{action}", json=options)


async def test_the_same_semester_of_the_last_session_is_suggested(last_year):
    sources = await _ok(await last_year["admin"].get(f"{API}/timetable-import/copy/sources"))
    assert sources["suggested_id"] == last_year["old"]["id"]
    assert [(s["session_name"], s["lectures"], s["exams"]) for s in sources["semesters"] if s["id"] == last_year["old"]["id"]] == [
        ("2025/2026", 2, 2),
    ]


async def test_copying_lectures_for_all_faculties_keeps_each_faculty(last_year):
    admin = last_year["admin"]
    preview = await _ok(await _copy(admin, "preview", item_type="lecture", source_semester_id=last_year["old"]["id"]))
    assert preview["ready"] and preview["file_name"] == "2025/2026 First Semester"
    result = await _ok(await _copy(admin, "apply", item_type="lecture", source_semester_id=last_year["old"]["id"]))
    assert result["created"] == 2
    assert sorted((i["faculty_id"], i["day_of_week"], i["start_time"], i["semester_id"]) for i in await _items(last_year)) == [
        ("ENG", "Monday", "08:00:00", last_year["semester"]["id"]),
        ("SCI", "Tuesday", "09:00:00", last_year["semester"]["id"]),
    ]

    imports = await _ok(await admin.get(f"{API}/timetable-import/imports"))
    assert (imports[0]["faculty_name"], imports[0]["copied"], imports[0]["file_name"]) == ("All faculties", True, "2025/2026 First Semester")
    await _ok(await _revert(admin, result["import_id"]))
    assert await _items(last_year) == []


async def test_copying_one_faculty_leaves_the_others(last_year):
    result = await _ok(await _copy(last_year["admin"], "apply", item_type="lecture", faculty_id="SCI",
                                   source_semester_id=last_year["old"]["id"]))
    assert result["created"] == 1
    assert [i["faculty_id"] for i in await _items(last_year)] == ["SCI"]


async def test_copied_exams_keep_their_weekdays_from_the_new_first_date(last_year):
    admin = last_year["admin"]
    preview = await _ok(await _copy(admin, "preview", item_type="exam", source_semester_id=last_year["old"]["id"]))
    assert preview["questions"]["exam_start_date"] and not preview["ready"]

    # Last time they began on a Wednesday; the new first exam date is a Monday.
    answers = {"exam_start_date": "2027-03-01"}
    preview = await _ok(await _copy(admin, "preview", item_type="exam", source_semester_id=last_year["old"]["id"], answers=answers))
    assert [(i["code"], i["exam_date"], i["week"]) for i in preview["items"]] == [
        ("CVE202", "2027-03-03", 1),  # Wednesday stays Wednesday
        ("CVE203", "2027-03-08", 2),  # and the next Monday stays a week on
    ]


async def test_copying_from_the_current_semester_is_refused(last_year):
    response = await _copy(last_year["admin"], "preview", item_type="lecture", source_semester_id=last_year["semester"]["id"])
    assert response.status_code == 400


async def test_only_super_admins_can_copy(last_year, make_client, make_user, login):
    editor = make_client()
    await login(editor, (await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG"))["email"])
    assert (await editor.get(f"{API}/timetable-import/copy/sources")).status_code == 403
    assert (await _copy(editor, "preview", item_type="lecture", source_semester_id=last_year["old"]["id"])).status_code == 403
