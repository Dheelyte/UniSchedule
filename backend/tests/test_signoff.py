"""Signatures and stamps on FINAL timetables, and their public verification codes."""
import re

from sqlalchemy import select

from core.database import async_session_maker
from modules.audit.models import ActivityLog
from modules.auth.models import RoleEnum

API = "/api/v1"
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
CODE = re.compile(r"^UG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$")


async def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


async def _semester(admin, name="2025/2026") -> int:
    session = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": name}))
    await _ok(await admin.put(f"{API}/calendar/sessions/{session['id']}/current"))
    semester = await _ok(await admin.post(
        f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": session["id"]}
    ))
    return semester["id"]


async def _lock(admin, semester_id, locked=True, kind="lecture"):
    await _ok(await admin.put(f"{API}/timetable/locks/{kind}?semester_id={semester_id}", json={"is_locked": locked}))


async def _export(client, semester_id, kind="lecture"):
    return await _ok(await client.get(f"{API}/signoffs/export?semester_id={semester_id}&timetable_type={kind}"))


async def test_defaults_to_the_vice_chancellor(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    rows = await _ok(await admin.get(f"{API}/signoffs"))
    assert [(r["timetable_type"], r["signatory_title"], r["signature_image"]) for r in rows] == [
        ("lecture", "Vice-Chancellor", None),
        ("exam", "Vice-Chancellor", None),
    ]


async def test_super_admin_sets_the_signoff_per_timetable_type(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    body = {"signatory_name": " Prof. A. Example ", "signatory_title": "Registrar", "signature_image": PNG, "stamp_image": PNG}
    saved = await _ok(await admin.put(f"{API}/signoffs/exam", json=body))
    assert (saved["signatory_name"], saved["signatory_title"], saved["stamp_image"]) == ("Prof. A. Example", "Registrar", PNG)

    rows = {r["timetable_type"]: r for r in await _ok(await admin.get(f"{API}/signoffs"))}
    assert rows["exam"]["signatory_title"] == "Registrar"
    assert rows["lecture"]["signatory_title"] == "Vice-Chancellor"

    # Leaving a field out keeps it; null removes an image.
    saved = await _ok(await admin.put(f"{API}/signoffs/exam", json={"stamp_image": None}))
    assert (saved["signatory_title"], saved["signature_image"], saved["stamp_image"]) == ("Registrar", PNG, None)


async def test_rejects_non_png_images_and_empty_titles(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    bad = await admin.put(f"{API}/signoffs/lecture", json={"signature_image": "data:image/svg+xml;base64,PHN2Zy8+"})
    assert bad.status_code == 422, bad.text
    huge = await admin.put(f"{API}/signoffs/lecture", json={"stamp_image": PNG + "A" * 800_000})
    assert huge.status_code == 422, huge.text
    empty = await admin.put(f"{API}/signoffs/lecture", json={"signatory_title": "   "})
    assert empty.status_code == 400, empty.text


async def test_only_super_admins_manage_signoffs(signed_in):
    for role in (RoleEnum.SUPER_VIEWER, RoleEnum.FACULTY_EDITOR, RoleEnum.CITS_ADMIN):
        client, _ = await signed_in(role, faculty_id="ENG" if role == RoleEnum.FACULTY_EDITOR else None)
        assert (await client.get(f"{API}/signoffs")).status_code == 403
        assert (await client.put(f"{API}/signoffs/lecture", json={"signatory_name": "X"})).status_code == 403


async def test_audit_log_records_the_change_without_the_images(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    await _ok(await admin.put(f"{API}/signoffs/lecture", json={"signatory_name": "Prof. B", "signature_image": PNG}))
    async with async_session_maker() as session:
        entry = (await session.execute(
            select(ActivityLog).where(ActivityLog.action == "timetable.signoff.update")
        )).scalar_one()
    assert entry.extra["changed"] == ["name", "signature"]
    assert PNG not in str(entry.extra) and PNG not in entry.description


async def test_draft_exports_are_not_signed(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    semester_id = await _semester(admin)
    await _ok(await admin.put(f"{API}/signoffs/lecture", json={"signature_image": PNG}))
    assert await _export(admin, semester_id) == {
        "is_locked": False, "signatory_name": None, "signatory_title": None,
        "signature_image": None, "stamp_image": None, "verification": None,
    }


async def test_final_exports_are_signed_and_carry_a_code(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    viewer, _ = await signed_in(RoleEnum.SUPER_VIEWER)
    semester_id = await _semester(admin)
    await _ok(await admin.put(f"{API}/signoffs/lecture", json={"signatory_name": "Prof. C", "signature_image": PNG, "stamp_image": PNG}))
    await _lock(admin, semester_id)

    signed = await _export(viewer, semester_id)
    assert (signed["is_locked"], signed["signatory_name"], signed["signatory_title"]) == (True, "Prof. C", "Vice-Chancellor")
    assert signed["signature_image"] == PNG and signed["stamp_image"] == PNG
    assert CODE.match(signed["verification"]["code"])
    # Every export of the same FINAL version carries the same code.
    assert (await _export(admin, semester_id))["verification"]["code"] == signed["verification"]["code"]
    # The exam timetable of the same semester isn't locked, so it isn't signed.
    assert (await _export(admin, semester_id, "exam"))["is_locked"] is False


async def test_verification_follows_the_lock(signed_in, client):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    semester_id = await _semester(admin)
    await _lock(admin, semester_id)
    first = (await _export(admin, semester_id))["verification"]["code"]

    # Public: no sign-in needed, and nothing about the signature is exposed.
    page = await _ok(await client.get(f"{API}/verify/{first.lower()}"))
    assert (page["status"], page["realm_name"], page["session_name"], page["semester_name"], page["timetable_type"]) == (
        "current", "Undergraduate", "2025/2026", "First Semester", "lecture",
    )
    assert "signature_image" not in page and "stamp_image" not in page

    # Locking again while locked keeps the code.
    await _lock(admin, semester_id)
    assert (await _export(admin, semester_id))["verification"]["code"] == first

    await _lock(admin, semester_id, locked=False)
    reopened = await _ok(await client.get(f"{API}/verify/{first}"))
    assert reopened["status"] == "reopened" and reopened["reopened_at"]

    await _lock(admin, semester_id)
    second = (await _export(admin, semester_id))["verification"]["code"]
    assert second != first
    superseded = await _ok(await client.get(f"{API}/verify/{first}"))
    assert superseded["status"] == "superseded" and superseded["superseded_at"]
    assert (await _ok(await client.get(f"{API}/verify/{second}")))["status"] == "current"


async def test_unknown_codes_are_not_found(client):
    assert (await client.get(f"{API}/verify/UG-AAAA-BBBB")).status_code == 404


async def test_realms_keep_their_own_signoffs(signed_in):
    ug, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    ice, _ = await signed_in(RoleEnum.SUPER_ADMIN, login_realm="ICE")
    await _ok(await ug.put(f"{API}/signoffs/lecture", json={"signatory_title": "Registrar", "signature_image": PNG}))

    ice_rows = {r["timetable_type"]: r for r in await _ok(await ice.get(f"{API}/signoffs"))}
    assert (ice_rows["lecture"]["signatory_title"], ice_rows["lecture"]["signature_image"]) == ("Vice-Chancellor", None)

    # Another realm's semester is not found, so its signature can't be fetched from here.
    ug_semester = await _semester(ug)
    await _lock(ug, ug_semester)
    assert (await ice.get(f"{API}/signoffs/export?semester_id={ug_semester}&timetable_type=lecture")).status_code == 404

    ice_semester = await _semester(ice, name="ICE 2025/2026")
    await _lock(ice, ice_semester)
    ice_export = await _export(ice, ice_semester)
    assert ice_export["signature_image"] is None
    assert ice_export["verification"]["code"].startswith("ICE-")
