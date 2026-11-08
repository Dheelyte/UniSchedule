"""Export bundles for staff, and the public download of FINAL timetables."""
import pytest

from core.config import settings
from modules.auth.models import RoleEnum

API = "/api/v1"
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
DAY = {"UG": "Monday", "ICE": "Monday"}


async def _ok(response, status: int = 200):
    assert response.status_code == status, response.text
    return response.json() if response.content else None


async def _realm(admin, key: str) -> dict:
    """One faculty, two departments, one room, a semester and a scheduled lecture and exam."""
    faculty = await _ok(await admin.post(f"{API}/timetable/faculties", json={"id": "SCI", "name": "Science"}))
    owner = await _ok(await admin.post(f"{API}/timetable/departments", json={"name": "Physics", "faculty_id": faculty["id"]}))
    taker = await _ok(await admin.post(f"{API}/timetable/departments", json={"name": "Chemistry", "faculty_id": faculty["id"]}))
    room = await _ok(await admin.post(f"{API}/timetable/rooms", json={"name": "LT 1", "faculty_id": faculty["id"]}))
    session = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": f"{key} 2025/2026"}))
    await _ok(await admin.put(f"{API}/calendar/sessions/{session['id']}/current"))
    semester = await _ok(await admin.post(
        f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": session["id"]}
    ))
    await _ok(await admin.put(f"{API}/calendar/semesters/{semester['id']}/current"))
    course = await _ok(await admin.post(f"{API}/timetable/courses", json={
        "code": "PHY201", "title": "Mechanics", "department_id": owner["id"], "level": 200, "scope": "INTERFACULTY",
    }))
    unused = await _ok(await admin.post(f"{API}/timetable/courses", json={
        "code": "PHY299", "title": "Unscheduled", "department_id": owner["id"], "level": 200,
    }))
    await _ok(await admin.post(f"{API}/timetable/enrollments", json={
        "course_id": course["id"], "department_id": taker["id"], "level": 300,
    }), 201)
    lecture = await _ok(await admin.post(f"{API}/timetable/schedule-items", json={
        "course_id": course["id"], "room_ids": [room["id"]], "faculty_id": faculty["id"],
        "day_of_week": DAY[key], "start_time": "18:00:00" if key == "ICE" else "10:00:00",
        "end_time": "20:00:00" if key == "ICE" else "12:00:00", "type": "lecture",
    }))
    return {
        "faculty": faculty, "owner": owner, "taker": taker, "room": room, "semester": semester,
        "course": course, "unused": unused, "lecture": lecture,
    }


@pytest.fixture
async def ug(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    return {"admin": admin, **await _realm(admin, "UG")}


async def _lock(admin, semester_id, kind="lecture", locked=True):
    await _ok(await admin.put(f"{API}/timetable/locks/{kind}?semester_id={semester_id}", json={"is_locked": locked}))


def _bundle_url(semester_id, kind="lecture"):
    return f"{API}/export/bundle?semester_id={semester_id}&timetable_type={kind}"


def _public_url(semester_id, kind="lecture", realm="UG"):
    return f"{API}/public/export/bundle?realm={realm}&semester_id={semester_id}&timetable_type={kind}"


async def test_bundle_has_what_an_export_needs(ug):
    bundle = await _ok(await ug["admin"].get(_bundle_url(ug["semester"]["id"])))
    assert bundle["realm"]["key"] == "UG"
    assert bundle["realm"]["config"]["day_start"]
    assert (bundle["session_name"], bundle["semester_name"]) == ("UG 2025/2026", "First Semester")
    assert [i["id"] for i in bundle["schedule_items"]] == [ug["lecture"]["id"]]
    # Only the scheduled course, and its enrollments.
    assert [c["code"] for c in bundle["courses"]] == ["PHY201"]
    assert [(e["department_id"], e["level"]) for e in bundle["enrollments"]] == [(ug["taker"]["id"], 300)]
    assert {d["name"] for d in bundle["departments"]} == {"Physics", "Chemistry"}
    assert [r["name"] for r in bundle["rooms"]] == ["LT 1"]
    assert bundle["is_locked"] is False and bundle["signoff"]["verification"] is None

    # Only the requested type.
    exam = await _ok(await ug["admin"].get(_bundle_url(ug["semester"]["id"], "exam")))
    assert exam["schedule_items"] == [] and exam["courses"] == []


async def test_bundle_needs_a_sign_in_and_stays_in_the_realm(ug, signed_in, client):
    assert (await client.get(_bundle_url(ug["semester"]["id"]))).status_code == 401
    ice_admin, _ = await signed_in(RoleEnum.SUPER_ADMIN, login_realm="ICE")
    assert (await ice_admin.get(_bundle_url(ug["semester"]["id"]))).status_code == 404


async def test_a_signed_bundle_carries_the_signoff(ug):
    await _ok(await ug["admin"].put(f"{API}/signoffs/lecture", json={
        "signatory_name": "Prof. A", "signature_image": PNG, "stamp_image": PNG,
    }))
    await _lock(ug["admin"], ug["semester"]["id"])
    bundle = await _ok(await ug["admin"].get(_bundle_url(ug["semester"]["id"])))
    assert bundle["is_locked"] is True
    assert bundle["signoff"]["signature_image"] == PNG
    assert bundle["signoff"]["verification"]["code"].startswith("UG-")


async def test_drafts_are_not_public(ug, client):
    assert (await client.get(_public_url(ug["semester"]["id"]))).status_code == 404
    assert await _ok(await client.get(f"{API}/public/timetables")) == []
    options = await client.get(f"{API}/public/timetables/UG/{ug['semester']['id']}/lecture/options")
    assert options.status_code == 404


async def test_final_timetables_are_public_without_the_images(ug, client):
    await _ok(await ug["admin"].put(f"{API}/signoffs/lecture", json={
        "signatory_name": "Prof. A", "signature_image": PNG, "stamp_image": PNG,
    }))
    await _lock(ug["admin"], ug["semester"]["id"])
    semester_id = ug["semester"]["id"]

    published = await _ok(await client.get(f"{API}/public/timetables"))
    assert [(p["realm_key"], p["semester_id"], p["timetable_type"]) for p in published] == [("UG", semester_id, "lecture")]
    code = published[0]["code"]

    bundle = await _ok(await client.get(_public_url(semester_id)))
    assert bundle["signoff"]["verification"]["code"] == code
    assert bundle["signoff"]["signatory_name"] == "Prof. A"
    # No signature or stamp, and nothing a printed timetable doesn't show.
    assert "signature_image" not in bundle["signoff"] and "stamp_image" not in bundle["signoff"]
    assert set(bundle["rooms"][0]) == {"id", "name", "faculty_id", "is_active"}
    assert set(bundle["enrollments"][0]) == {"course_id", "department_id", "level"}
    assert "credit_load" not in bundle["courses"][0]
    # The exam timetable is still a draft.
    assert (await client.get(_public_url(semester_id, "exam"))).status_code == 404

    # Whatever the request sends, the images stay out.
    forged = await _ok(await client.get(_public_url(semester_id), headers={"X-Render-Token": "anything"}))
    assert "signature_image" not in forged["signoff"]


async def test_unlocking_withdraws_the_public_download(ug, client):
    await _lock(ug["admin"], ug["semester"]["id"])
    assert (await client.get(_public_url(ug["semester"]["id"]))).status_code == 200
    await _lock(ug["admin"], ug["semester"]["id"], locked=False)
    assert (await client.get(_public_url(ug["semester"]["id"]))).status_code == 404
    assert await _ok(await client.get(f"{API}/public/timetables")) == []


async def test_options_list_owners_and_enrolled_departments(ug, client):
    await _lock(ug["admin"], ug["semester"]["id"])
    options = await _ok(await client.get(f"{API}/public/timetables/UG/{ug['semester']['id']}/lecture/options"))
    assert [f["name"] for f in options["faculties"]] == ["Science"]
    assert [f["name"] for f in options["all_faculties"]] == ["Science"]
    assert [d["name"] for d in options["departments"]] == ["Chemistry", "Physics"]
    assert options["levels"] == [200, 300]
    # No CBT courses are scheduled.
    cbt = await client.get(f"{API}/public/timetables/UG/{ug['semester']['id']}/cbt/options")
    assert cbt.status_code == 404  # the exam timetable isn't locked


async def test_options_list_every_faculty_for_the_index(ug, client):
    await _ok(await ug["admin"].post(f"{API}/timetable/faculties", json={"id": "LAW", "name": "Law"}))
    await _lock(ug["admin"], ug["semester"]["id"])
    options = await _ok(await client.get(f"{API}/public/timetables/UG/{ug['semester']['id']}/lecture/options"))
    assert [f["id"] for f in options["faculties"]] == ["SCI"]
    assert [f["id"] for f in options["all_faculties"]] == ["LAW", "SCI"]


async def test_public_reads_stay_in_the_named_realm(ug, client):
    await _lock(ug["admin"], ug["semester"]["id"])
    # The UG semester asked for under ICE is not found.
    assert (await client.get(_public_url(ug["semester"]["id"], realm="ICE"))).status_code == 404
    assert (await client.get(_public_url(ug["semester"]["id"], realm="NOPE"))).status_code == 404


async def test_public_reads_need_the_export_key_when_one_is_set(ug, client, monkeypatch):
    await _lock(ug["admin"], ug["semester"]["id"])
    monkeypatch.setattr(settings, "PUBLIC_EXPORT_KEY", "frontend-secret")
    urls = [
        f"{API}/public/timetables",
        f"{API}/public/timetables/UG/{ug['semester']['id']}/lecture/options",
        _public_url(ug["semester"]["id"]),
    ]
    for url in urls:
        assert (await client.get(url)).status_code == 403, url
        assert (await client.get(url, headers={"X-Export-Key": "wrong"})).status_code == 403, url
        assert (await client.get(url, headers={"X-Export-Key": "frontend-secret"})).status_code == 200, url


async def test_public_reads_are_closed_in_production_without_a_key(ug, client, monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "prod")
    assert (await client.get(f"{API}/public/timetables")).status_code == 403


# ---------- Staff exports through the frontend server (export tickets) ----------

def _staff_url(semester_id, kind="lecture"):
    return f"{API}/export/staff-bundle?semester_id={semester_id}&timetable_type={kind}"


async def _ticket(staff, semester_id, kind="lecture"):
    body = await _ok(await staff.post(f"{API}/export/ticket", json={"semester_id": semester_id, "timetable_type": kind}))
    assert body["expires_in"] == 120
    return body["ticket"]


async def test_a_ticket_reads_the_same_bundle_as_the_user(ug, client):
    await _ok(await ug["admin"].put(f"{API}/signoffs/lecture", json={
        "signatory_name": "Prof. A", "signature_image": PNG, "stamp_image": PNG,
    }))
    await _lock(ug["admin"], ug["semester"]["id"])
    semester_id = ug["semester"]["id"]
    ticket = await _ticket(ug["admin"], semester_id)
    # The frontend server has no cookie, only the ticket.
    staff = await _ok(await client.get(_staff_url(semester_id), headers={"X-Export-Ticket": ticket}))
    assert staff == await _ok(await ug["admin"].get(_bundle_url(semester_id)))
    # Staff copies are signed and stamped, unlike public ones.
    assert staff["signoff"]["signature_image"] == PNG


async def test_tickets_need_a_sign_in(ug, client):
    response = await client.post(f"{API}/export/ticket", json={"semester_id": ug["semester"]["id"], "timetable_type": "lecture"})
    assert response.status_code == 401


async def test_a_ticket_is_only_for_its_semester_and_type(ug, client):
    semester_id = ug["semester"]["id"]
    ticket = await _ticket(ug["admin"], semester_id)
    assert (await client.get(_staff_url(semester_id))).status_code == 401
    assert (await client.get(_staff_url(semester_id), headers={"X-Export-Ticket": "junk"})).status_code == 401
    assert (await client.get(_staff_url(semester_id, "exam"), headers={"X-Export-Ticket": ticket})).status_code == 401
    assert (await client.get(_staff_url(semester_id + 1), headers={"X-Export-Ticket": ticket})).status_code == 401


async def test_a_ticket_is_not_a_login(ug, client):
    ticket = await _ticket(ug["admin"], ug["semester"]["id"])
    client.cookies.set("access_token", ticket)
    assert (await client.get(_bundle_url(ug["semester"]["id"]))).status_code == 401
    assert (await client.post(f"{API}/export/ticket", json={
        "semester_id": ug["semester"]["id"], "timetable_type": "lecture",
    })).status_code == 401


async def test_a_ticket_keeps_the_users_realm(ug, signed_in, client):
    # A super admin working in ICE gets ICE's data, so the UG semester is not found.
    ice_admin, _ = await signed_in(RoleEnum.SUPER_ADMIN, login_realm="ICE")
    ticket = await _ticket(ice_admin, ug["semester"]["id"])
    assert (await client.get(_staff_url(ug["semester"]["id"]), headers={"X-Export-Ticket": ticket})).status_code == 404


async def test_a_disabled_users_ticket_stops_working(ug, signed_in, client):
    from sqlalchemy import update
    from core.database import async_session_maker
    from modules.auth.models import User

    viewer, user = await signed_in(RoleEnum.SUPER_VIEWER)
    ticket = await _ticket(viewer, ug["semester"]["id"])
    async with async_session_maker() as session:
        await session.execute(update(User).where(User.id == user["id"]).values(is_active=False))
        await session.commit()
    assert (await client.get(_staff_url(ug["semester"]["id"]), headers={"X-Export-Ticket": ticket})).status_code == 403


async def test_staff_bundles_need_the_export_key_when_one_is_set(ug, client, monkeypatch):
    ticket = await _ticket(ug["admin"], ug["semester"]["id"])
    monkeypatch.setattr(settings, "PUBLIC_EXPORT_KEY", "frontend-secret")
    url = _staff_url(ug["semester"]["id"])
    assert (await client.get(url, headers={"X-Export-Ticket": ticket})).status_code == 403
    response = await client.get(url, headers={"X-Export-Ticket": ticket, "X-Export-Key": "frontend-secret"})
    assert response.status_code == 200
