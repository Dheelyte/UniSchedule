"""The HOD role (Heads of Department), shown as "Faculty Viewer (HOD)".

An HOD has exactly a Faculty Viewer's access, scoped to their faculty, and only a
Super Admin can invite one or move an account to or from the role.
"""
import pytest
from sqlalchemy import select

from core import mail
from core.database import async_session_maker
from modules.audit.models import ActivityLog
from modules.auth.models import Invitation, RoleEnum, User
from modules.notifications.models import Notification
from modules.timetable.models import ChangeRequest

API = "/api/v1"


async def _ok(response, status: int = 200):
    assert response.status_code == status, response.text
    return response.json() if response.content else None


async def _logs(action: str) -> list[ActivityLog]:
    async with async_session_maker() as session:
        return list((await session.execute(
            select(ActivityLog).where(ActivityLog.action == action).order_by(ActivityLog.id)
        )).scalars().all())


async def _stored(user_id: int) -> User:
    async with async_session_maker() as session:
        return await session.get(User, user_id)


@pytest.fixture(autouse=True)
def sent_emails(monkeypatch):
    """Capture notification emails: (recipients, title, message) tuples."""
    sent: list[tuple[list[str], str, str]] = []

    async def _capture(emails, title, message, link=None):
        sent.append((sorted(emails), title, message))

    monkeypatch.setattr(mail.EmailService, "send_generic_notification", staticmethod(_capture))
    return sent


@pytest.fixture(autouse=True)
def invitation_emails(monkeypatch):
    """Capture invitation emails: the keyword arguments of each send."""
    sent: list[dict] = []

    async def _capture(**kwargs):
        sent.append(kwargs)

    monkeypatch.setattr(mail.EmailService, "send_invitation_email", staticmethod(_capture))
    return sent


def _lecture(realm: dict, faculty: str = "eng", **overrides) -> dict:
    return {
        "course_id": realm[f"{faculty}_course"]["id"],
        "room_ids": [realm[f"{faculty}_room"]["id"]],
        "faculty_id": realm[faculty]["id"],
        "day_of_week": realm["day"],
        "start_time": "10:00:00",
        "end_time": "12:00:00",
        "type": "lecture",
        **overrides,
    }


@pytest.fixture
async def campus(make_client, make_user, login) -> dict:
    """UG with two faculties (ENG and SCI) and ICE with one, each with a department,
    room, course, enrollment and a lecture in the current semester, built through the API."""
    realms = {}
    for key, day, faculties in (("UG", "Monday", ("eng", "sci")), ("ICE", "Friday", ("eng",))):
        admin = make_client()
        await login(admin, (await make_user(RoleEnum.SUPER_ADMIN))["email"], realm=key)
        realm = {"key": key, "day": day, "admin": admin}
        session = await _ok(await admin.post(f"{API}/calendar/sessions", json={"name": f"{key} 2025/2026"}))
        await _ok(await admin.put(f"{API}/calendar/sessions/{session['id']}/current"))
        semester = await _ok(await admin.post(
            f"{API}/calendar/semesters", json={"name": "First Semester", "session_id": session["id"]}
        ))
        await _ok(await admin.put(f"{API}/calendar/semesters/{semester['id']}/current"))
        realm["semester"] = semester
        for name in faculties:
            faculty = await _ok(await admin.post(
                f"{API}/timetable/faculties", json={"id": name.upper(), "name": name.title()}
            ))
            department = await _ok(await admin.post(
                f"{API}/timetable/departments", json={"name": f"{name.title()} Dept", "faculty_id": faculty["id"]}
            ))
            room = await _ok(await admin.post(
                f"{API}/timetable/rooms", json={"name": f"{name.upper()} 101", "faculty_id": faculty["id"]}
            ))
            course = await _ok(await admin.post(f"{API}/timetable/courses", json={
                "code": f"{name.upper()[:3]}201", "title": f"{key} {name} course",
                "department_id": department["id"], "level": 200, "scope": "INTERFACULTY",
            }))
            realm.update({
                name: faculty, f"{name}_department": department, f"{name}_room": room, f"{name}_course": course,
            })
            realm[f"{name}_enrollment"] = await _ok(await admin.post(f"{API}/timetable/enrollments", json={
                "course_id": course["id"], "department_id": department["id"], "level": 200,
            }), 201)
            realm[f"{name}_item"] = await _ok(await admin.post(
                f"{API}/timetable/schedule-items", json=_lecture(realm, name)
            ))
        realms[key] = realm
    return realms


async def _staff(make_client, make_user, login, role: RoleEnum, realm: dict, faculty: str = "eng"):
    user = await make_user(role, faculty_id=realm[faculty]["id"], realm=realm["key"])
    client = make_client()
    await login(client, user["email"])
    return client, user


# --- Inviting an HOD -------------------------------------------------------

async def test_super_admin_invites_an_hod(campus, client, invitation_emails):
    admin = campus["UG"]["admin"]
    body = await _ok(await admin.post(f"{API}/auth/invite", json={
        "email": "hod@example.com", "target_role": "HOD", "faculty_id": "ENG",
    }))

    async with async_session_maker() as session:
        invitation = (await session.execute(select(Invitation))).scalar_one()
    assert (invitation.target_role, invitation.faculty_id, invitation.realm_key) == (RoleEnum.HOD, "ENG", "UG")
    [log] = await _logs("user.invite")
    assert log.description == "Invited hod@example.com as Faculty Viewer (HOD)"
    assert log.extra["role"] == "HOD"
    [email] = invitation_emails
    assert (email["recipient_email"], email["role"], email["faculty_name"]) == ("hod@example.com", "Faculty Viewer (HOD)", "Eng")

    # Accepting the invitation creates an HOD account in that faculty and realm.
    await _ok(await client.post(f"{API}/auth/register/{body['token']}", json={"password": "Password123"}))
    async with async_session_maker() as session:
        user = (await session.execute(select(User).where(User.email == "hod@example.com"))).scalar_one()
    assert (user.role, user.faculty_id, user.realm_key) == (RoleEnum.HOD, "ENG", "UG")
    [log] = await _logs("user.register")
    assert log.description == "hod@example.com registered as Faculty Viewer (HOD)"

    # The invitation and the account are listed with the HOD role.
    assert [i["target_role"] for i in await _ok(await admin.get(f"{API}/auth/invitations"))] == []
    assert "HOD" in {u["role"] for u in await _ok(await admin.get(f"{API}/auth/users"))}


async def test_hod_invite_needs_a_faculty(campus):
    response = await campus["UG"]["admin"].post(f"{API}/auth/invite", json={
        "email": "hod@example.com", "target_role": "HOD",
    })
    assert response.status_code == 400, response.text
    async with async_session_maker() as session:
        assert (await session.execute(select(Invitation))).scalars().all() == []


async def test_hod_invite_to_another_realms_faculty_is_404(campus):
    response = await campus["UG"]["admin"].post(f"{API}/auth/invite", json={
        "email": "hod@example.com", "target_role": "HOD", "faculty_id": campus["ICE"]["eng"]["id"],
    })
    assert response.status_code == 404, response.text


async def test_faculty_editor_cannot_invite_an_hod(campus, make_client, make_user, login, invitation_emails):
    editor, _ = await _staff(make_client, make_user, login, RoleEnum.FACULTY_EDITOR, campus["UG"])
    for faculty_id in ("ENG", None):
        response = await editor.post(f"{API}/auth/invite", json={
            "email": "hod@example.com", "target_role": "HOD", "faculty_id": faculty_id,
        })
        assert response.status_code == 403, response.text
    async with async_session_maker() as session:
        assert (await session.execute(select(Invitation))).scalars().all() == []
    assert invitation_emails == []


@pytest.mark.parametrize("role", [RoleEnum.HOD, RoleEnum.FACULTY_VIEWER, RoleEnum.DEO])
async def test_viewers_cannot_invite_anyone(campus, make_client, make_user, login, role):
    client, _ = await _staff(make_client, make_user, login, role, campus["UG"])
    response = await client.post(f"{API}/auth/invite", json={
        "email": "x@example.com", "target_role": "HOD", "faculty_id": "ENG",
    })
    assert response.status_code == 403, response.text


# --- Changing an account to and from HOD -----------------------------------

def _patch(client, user_id: int, role: str, faculty_id: str | None = None):
    return client.patch(f"{API}/auth/users/{user_id}", json={"role": role, "faculty_id": faculty_id})


async def test_super_admin_moves_a_viewer_to_hod_and_back(campus, make_user, sent_emails):
    admin = campus["UG"]["admin"]
    viewer = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG", email="jane@example.com")

    body = await _ok(await _patch(admin, viewer["id"], "HOD", "ENG"))
    assert (body["role"], body["faculty_id"], body["realm_key"]) == ("HOD", "ENG", "UG")
    assert (await _stored(viewer["id"])).role == RoleEnum.HOD

    body = await _ok(await _patch(admin, viewer["id"], "FACULTY_VIEWER", "SCI"))
    assert (body["role"], body["faculty_id"]) == ("FACULTY_VIEWER", "SCI")

    to_hod, from_hod = await _logs("user.role_change")
    assert to_hod.description == "Changed jane@example.com from FACULTY_VIEWER to Faculty Viewer (HOD) (faculty ENG)"
    assert (to_hod.extra["from_role"], to_hod.extra["to_role"]) == ("FACULTY_VIEWER", "HOD")
    assert from_hod.description == "Changed jane@example.com from Faculty Viewer (HOD) to FACULTY_VIEWER (faculty SCI)"
    assert (from_hod.extra["from_role"], from_hod.extra["to_role"]) == ("HOD", "FACULTY_VIEWER")

    # The account holder is told, in-app and by email, each time.
    async with async_session_maker() as session:
        messages = [n.message for n in (await session.execute(
            select(Notification).where(Notification.user_id == viewer["id"]).order_by(Notification.id)
        )).scalars().all()]
    expected = [
        "Your role has been changed from Faculty Viewer to Faculty Viewer (HOD) for Eng. "
        "The change applies the next time you use UniSchedule.",
        "Your role has been changed from Faculty Viewer (HOD) to Faculty Viewer for Sci. "
        "The change applies the next time you use UniSchedule.",
    ]
    assert messages == expected
    assert [message for _, _, message in sent_emails] == expected


async def test_hod_moved_to_editor_gets_editor_access_on_the_next_request(campus, make_client, make_user, login):
    hod, user = await _staff(make_client, make_user, login, RoleEnum.HOD, campus["UG"])
    assert (await _ok(await hod.get(f"{API}/auth/me")))["role"] == "HOD"
    await _ok(await _patch(campus["UG"]["admin"], user["id"], "FACULTY_EDITOR", "ENG"))
    assert (await _ok(await hod.get(f"{API}/auth/me")))["role"] == "FACULTY_EDITOR"


async def test_hod_role_change_needs_a_faculty(campus, make_user):
    viewer = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")
    response = await _patch(campus["UG"]["admin"], viewer["id"], "HOD")
    assert response.status_code == 400, response.text
    assert (await _stored(viewer["id"])).role == RoleEnum.FACULTY_VIEWER


@pytest.mark.parametrize("role", [RoleEnum.FACULTY_EDITOR, RoleEnum.HOD, RoleEnum.FACULTY_VIEWER])
async def test_only_a_super_admin_can_assign_or_remove_hod(campus, make_client, make_user, login, role):
    client, _ = await _staff(make_client, make_user, login, role, campus["UG"])
    viewer = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")
    hod = await make_user(RoleEnum.HOD, faculty_id="ENG")

    assert (await _patch(client, viewer["id"], "HOD", "ENG")).status_code == 403
    assert (await _patch(client, hod["id"], "FACULTY_VIEWER", "ENG")).status_code == 403
    assert (await _stored(viewer["id"])).role == RoleEnum.FACULTY_VIEWER
    assert (await _stored(hod["id"])).role == RoleEnum.HOD


async def test_super_admin_can_view_as_hod(campus):
    admin = campus["UG"]["admin"]
    assert (await admin.post(f"{API}/auth/impersonate", json={"role": "HOD"})).status_code == 400
    await _ok(await admin.post(f"{API}/auth/impersonate", json={"role": "HOD", "faculty_id": "ENG"}))
    me = await _ok(await admin.get(f"{API}/auth/me"))
    assert (me["role"], me["faculty_id"], me["impersonating"]) == ("HOD", "ENG", True)
    [log] = await _logs("auth.impersonate.start")
    assert log.description.endswith("started acting as Faculty Viewer (HOD) (faculty ENG)")


# --- Same access as a Faculty Viewer ---------------------------------------

READS = (
    "/timetable/faculties", "/timetable/faculties?all=true",
    "/timetable/departments", "/timetable/departments?all=true",
    "/timetable/rooms", "/timetable/rooms?all=true",
    "/timetable/courses", "/timetable/schedule-items", "/timetable/blocked-slots",
    "/timetable/enrollments", "/timetable/conflict-dismissals",
    "/calendar/sessions", "/calendar/semesters/current",
)


async def _reads(client, realm: dict) -> dict:
    paths = READS + (
        f"/timetable/schedule-items?semester_id={realm['semester']['id']}",
        f"/timetable/locks?semester_id={realm['semester']['id']}",
        f"/export/bundle?semester_id={realm['semester']['id']}&timetable_type=lecture",
        f"/export/bundle?semester_id={realm['semester']['id']}&timetable_type=exam",
    )
    seen = {}
    for path in paths:
        response = await client.get(f"{API}{path}")
        seen[path] = (response.status_code, response.json())
    return seen


async def test_hod_reads_exactly_what_a_faculty_viewer_reads(campus, make_client, make_user, login):
    ug = campus["UG"]
    hod, _ = await _staff(make_client, make_user, login, RoleEnum.HOD, ug)
    viewer, _ = await _staff(make_client, make_user, login, RoleEnum.FACULTY_VIEWER, ug)

    hod_reads = await _reads(hod, ug)
    assert hod_reads == await _reads(viewer, ug)
    assert all(status == 200 for status, _ in hod_reads.values()), hod_reads


async def test_hod_sees_only_their_faculty_and_realm(campus, make_client, make_user, login):
    ug, ice = campus["UG"], campus["ICE"]
    hod, _ = await _staff(make_client, make_user, login, RoleEnum.HOD, ug)

    async def ids(path: str) -> set:
        return {row["id"] for row in await _ok(await hod.get(f"{API}{path}"))}

    # Faculty-scoped lists: their own faculty only.
    assert await ids("/timetable/faculties") == {"ENG"}
    assert await ids("/timetable/departments") == {ug["eng_department"]["id"]}
    assert await ids("/timetable/rooms") == {ug["eng_room"]["id"]}
    assert await ids("/timetable/enrollments") == {ug["eng_enrollment"]["id"]}
    # The realm-wide lists (as for a Faculty Viewer) hold UG's rows and never ICE's.
    assert await ids("/timetable/faculties?all=true") == {"ENG", "SCI"}
    assert await ids("/timetable/departments?all=true") == {ug["eng_department"]["id"], ug["sci_department"]["id"]}
    assert await ids("/timetable/rooms?all=true") == {ug["eng_room"]["id"], ug["sci_room"]["id"]}
    assert await ids("/timetable/courses") == {ug["eng_course"]["id"], ug["sci_course"]["id"]}
    assert await ids("/timetable/schedule-items") == {ug["eng_item"]["id"], ug["sci_item"]["id"]}
    assert await ids("/calendar/sessions") == {ug["semester"]["session_id"]}
    assert (await _ok(await hod.get(f"{API}/calendar/semesters/current")))["id"] == ug["semester"]["id"]
    # Asking by ICE's ids finds nothing.
    assert await ids(f"/timetable/schedule-items?semester_id={ice['semester']['id']}") == set()
    assert await ids(f"/timetable/courses/{ice['eng_course']['id']}/enrollments") == set()
    assert await ids(f"/calendar/sessions/{ice['semester']['session_id']}/semesters") == set()
    # Another realm's timetable can't be downloaded.
    response = await hod.get(f"{API}/export/bundle", params={"semester_id": ice["semester"]["id"], "timetable_type": "lecture"})
    assert response.status_code == 404, response.text


async def test_hod_cannot_change_anything_a_viewer_cannot(campus, make_client, make_user, login):
    ug = campus["UG"]
    hod, _ = await _staff(make_client, make_user, login, RoleEnum.HOD, ug)
    viewer, _ = await _staff(make_client, make_user, login, RoleEnum.FACULTY_VIEWER, ug)

    def writes(client):
        return {
            "add course": client.post(f"{API}/timetable/courses", json={
                "code": "ENG301", "title": "New", "department_id": ug["eng_department"]["id"], "level": 300,
                "scope": "INTERFACULTY",
            }),
            "schedule": client.post(f"{API}/timetable/schedule-items", json=_lecture(ug, start_time="14:00:00", end_time="16:00:00")),
            "move": client.put(f"{API}/timetable/schedule-items/{ug['eng_item']['id']}", json=_lecture(ug, start_time="14:00:00", end_time="16:00:00")),
            "delete item": client.delete(f"{API}/timetable/schedule-items/{ug['eng_item']['id']}"),
            "add room": client.post(f"{API}/timetable/rooms", json={"name": "ENG 102", "faculty_id": "ENG"}),
            "add department": client.post(f"{API}/timetable/departments", json={"name": "New", "faculty_id": "ENG"}),
            "dismiss conflict": client.post(f"{API}/timetable/conflict-dismissals", json={
                "conflict_type": "time", "item_a_id": ug["eng_item"]["id"], "reason": "fine",
            }),
            "list staff": client.get(f"{API}/auth/users"),
            "activity log": client.get(f"{API}/audit/logs"),
        }

    hod_statuses = {name: (await call).status_code for name, call in writes(hod).items()}
    viewer_statuses = {name: (await call).status_code for name, call in writes(viewer).items()}
    assert hod_statuses == viewer_statuses
    assert all(status == 403 for status in hod_statuses.values()), hod_statuses


async def test_hod_submits_a_change_request_while_unlocked(campus, make_client, make_user, login):
    ug = campus["UG"]
    hod, user = await _staff(make_client, make_user, login, RoleEnum.HOD, ug)
    request = await _ok(await hod.post(f"{API}/timetable/change-requests", json=_lecture(
        ug, timetable_type="lecture", action="ADD", start_time="14:00:00", end_time="16:00:00", reason="extra class",
    )))
    assert request["status"] == "PENDING"

    async with async_session_maker() as session:
        stored = await session.get(ChangeRequest, request["id"])
    assert (stored.requested_by, stored.realm_key) == (user["id"], "UG")
    # They see their own request; the super admin sees it to review.
    assert [r["id"] for r in await _ok(await hod.get(f"{API}/timetable/change-requests"))] == [request["id"]]
    assert request["id"] in {r["id"] for r in await _ok(await ug["admin"].get(f"{API}/timetable/change-requests"))}


async def test_hod_change_requests_stay_in_their_faculty(campus, make_client, make_user, login):
    ug = campus["UG"]
    hod, _ = await _staff(make_client, make_user, login, RoleEnum.HOD, ug)
    viewer, _ = await _staff(make_client, make_user, login, RoleEnum.FACULTY_VIEWER, ug)
    body = _lecture(ug, "sci", timetable_type="lecture", action="ADD", start_time="14:00:00", end_time="16:00:00", reason="x")
    hod_status = (await hod.post(f"{API}/timetable/change-requests", json=body)).status_code
    assert hod_status == (await viewer.post(f"{API}/timetable/change-requests", json=body)).status_code == 403


async def test_hod_cannot_request_changes_while_locked(campus, make_client, make_user, login):
    ug = campus["UG"]
    hod, _ = await _staff(make_client, make_user, login, RoleEnum.HOD, ug)
    viewer, _ = await _staff(make_client, make_user, login, RoleEnum.FACULTY_VIEWER, ug)
    await _ok(await ug["admin"].put(
        f"{API}/timetable/locks/lecture", params={"semester_id": ug["semester"]["id"]}, json={"is_locked": True}
    ))
    body = _lecture(ug, timetable_type="lecture", action="ADD", start_time="14:00:00", end_time="16:00:00", reason="x")
    hod_status = (await hod.post(f"{API}/timetable/change-requests", json=body)).status_code
    assert hod_status == (await viewer.post(f"{API}/timetable/change-requests", json=body)).status_code
    assert hod_status >= 400
