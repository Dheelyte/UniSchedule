"""A super admin changing a registered staff member's role (PATCH /auth/users/{id})."""
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from core import mail
from core.database import async_session_maker
from modules.audit.models import ActivityLog
from modules.audit.repository import AuditRepository
from modules.audit.service import AuditService
from modules.auth.models import RoleEnum, User
from modules.auth.repository import AuthRepository
from modules.auth.schemas import UpdateUserRoleRequest
from modules.auth.service import AuthService
from modules.notifications.models import Notification
from modules.notifications.repository import NotificationRepository
from modules.notifications.service import NotificationService
from modules.realms.repository import RealmRepository
from modules.timetable.models import Faculty

API = "/api/v1"


async def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


async def _me(client) -> dict:
    return await _ok(await client.get(f"{API}/auth/me"))


async def _stored(user_id: int) -> User:
    async with async_session_maker() as session:
        return await session.get(User, user_id)


async def _notifications(user_id: int) -> list[Notification]:
    async with async_session_maker() as session:
        return (await session.execute(
            select(Notification).where(Notification.user_id == user_id)
        )).scalars().all()


@pytest.fixture(autouse=True)
def sent_emails(monkeypatch):
    """Capture notification emails instead of sending them: (recipients, title, message) tuples."""
    sent: list[tuple[list[str], str, str]] = []

    async def _capture(emails, title, message, link=None):
        sent.append((sorted(emails), title, message))

    monkeypatch.setattr(mail.EmailService, "send_generic_notification", staticmethod(_capture))
    return sent


@pytest.fixture(autouse=True)
async def faculties():
    async with async_session_maker() as session:
        session.add_all([
            Faculty(id="ENG", name="Engineering", realm_key="UG"),
            Faculty(id="SCI", name="Science", realm_key="UG"),
            Faculty(id="ICE-ENG", name="Engineering", realm_key="ICE"),
        ])
        await session.commit()


@pytest.fixture
async def admin(signed_in):
    client, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    return client


def _patch(client, user_id: int, role: str, faculty_id: str | None = None, semester_id: int | None = None):
    return client.patch(
        f"{API}/auth/users/{user_id}",
        json={"role": role, "faculty_id": faculty_id, "semester_id": semester_id},
    )


# --- Changing roles ---------------------------------------------------------

async def test_upgrade_viewer_to_editor(admin, make_user):
    viewer = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")
    body = await _ok(await _patch(admin, viewer["id"], "FACULTY_EDITOR", "ENG"))
    assert (body["role"], body["faculty_id"], body["realm_key"]) == ("FACULTY_EDITOR", "ENG", "UG")


async def test_downgrade_editor_to_viewer_in_another_faculty(admin, make_user):
    editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")
    await _ok(await _patch(admin, editor["id"], "FACULTY_VIEWER", "SCI"))
    stored = await _stored(editor["id"])
    assert (stored.role, stored.faculty_id) == (RoleEnum.FACULTY_VIEWER, "SCI")


async def test_global_role_clears_the_faculty(admin, make_user):
    editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")
    body = await _ok(await _patch(admin, editor["id"], "GS_ADMIN", "ENG"))
    assert (body["role"], body["faculty_id"], body["realm_key"]) == ("GS_ADMIN", None, "UG")


async def test_moving_across_the_cross_realm_boundary_sets_the_realm(signed_in, make_user):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN, login_realm="ICE")
    editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ICE-ENG", realm="ICE")

    body = await _ok(await _patch(admin, editor["id"], "SUPER_VIEWER"))
    assert (body["role"], body["faculty_id"], body["realm_key"]) == ("SUPER_VIEWER", None, None)
    assert (await _stored(editor["id"])).realm_key is None

    # Back to a realm-bound role: it joins the admin's active realm.
    body = await _ok(await _patch(admin, editor["id"], "FACULTY_EDITOR", "ICE-ENG"))
    assert (body["role"], body["faculty_id"], body["realm_key"]) == ("FACULTY_EDITOR", "ICE-ENG", "ICE")
    assert (await _stored(editor["id"])).realm_key == "ICE"


async def test_cross_realm_user_moved_to_a_realm_bound_role_joins_the_active_realm(signed_in, make_user):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN, login_realm="ICE")
    cits = await make_user(RoleEnum.CITS_ADMIN)
    body = await _ok(await _patch(admin, cits["id"], "GS_ADMIN"))
    assert (body["role"], body["realm_key"]) == ("GS_ADMIN", "ICE")


# --- Validation ------------------------------------------------------------

@pytest.mark.parametrize("role", ["FACULTY_EDITOR", "FACULTY_VIEWER", "DEO"])
async def test_faculty_role_requires_a_faculty(admin, make_user, role):
    user = await make_user(RoleEnum.GS_ADMIN)
    response = await _patch(admin, user["id"], role)
    assert response.status_code == 400, response.text
    assert (await _stored(user["id"])).role == RoleEnum.GS_ADMIN


async def test_faculty_from_another_realm_is_404(admin, make_user):
    viewer = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")
    response = await _patch(admin, viewer["id"], "FACULTY_EDITOR", "ICE-ENG")
    assert response.status_code == 404, response.text
    assert (await _stored(viewer["id"])).faculty_id == "ENG"


async def test_user_from_another_realm_is_404(admin, make_user):
    ice_editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ICE-ENG", realm="ICE")
    response = await _patch(admin, ice_editor["id"], "GS_ADMIN")
    assert response.status_code == 404, response.text
    assert (await _stored(ice_editor["id"])).role == RoleEnum.FACULTY_EDITOR


async def test_missing_user_is_404(admin):
    assert (await _patch(admin, 9999, "GS_ADMIN")).status_code == 404


async def test_cannot_change_your_own_role(signed_in):
    admin, me = await signed_in(RoleEnum.SUPER_ADMIN)
    response = await _patch(admin, me["id"], "SUPER_VIEWER")
    assert response.status_code == 400, response.text
    assert (await _stored(me["id"])).role == RoleEnum.SUPER_ADMIN


async def test_demoting_another_super_admin_is_allowed(admin, make_user):
    other = await make_user(RoleEnum.SUPER_ADMIN)
    body = await _ok(await _patch(admin, other["id"], "SUPER_VIEWER"))
    assert body["role"] == "SUPER_VIEWER"


async def test_demoting_the_last_super_admin_is_400(make_user):
    # Through the API the caller is always another super admin, so the guard is
    # reached by calling the service as a caller whose account is gone.
    last = await make_user(RoleEnum.SUPER_ADMIN)
    caller = {"sub": "9999", "email": "gone@example.com", "role": "SUPER_ADMIN", "realm": "UG"}
    async with async_session_maker() as session:
        service = AuthService(
            repo=AuthRepository(session),
            audit_service=AuditService(AuditRepository(session), AuthRepository(session)),
            realm_repo=RealmRepository(session),
            notification_service=NotificationService(NotificationRepository(session), AuthRepository(session)),
        )
        with pytest.raises(HTTPException) as error:
            await service.update_user_role(last["id"], UpdateUserRoleRequest(role=RoleEnum.SUPER_VIEWER), caller)
    assert error.value.status_code == 400
    assert "at least one Super Admin" in error.value.detail
    assert (await _stored(last["id"])).role == RoleEnum.SUPER_ADMIN


# --- Who may change roles --------------------------------------------------

@pytest.mark.parametrize("role, faculty_id", [
    (RoleEnum.FACULTY_EDITOR, "ENG"),
    (RoleEnum.SUPER_VIEWER, None),
    (RoleEnum.GS_ADMIN, None),
    (RoleEnum.CITS_ADMIN, None),
])
async def test_other_roles_are_403(signed_in, make_user, role, faculty_id):
    client, _ = await signed_in(role, faculty_id=faculty_id)
    viewer = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")
    response = await _patch(client, viewer["id"], "FACULTY_EDITOR", "ENG")
    assert response.status_code == 403, response.text
    assert (await _stored(viewer["id"])).role == RoleEnum.FACULTY_VIEWER


async def test_impersonating_super_admin_is_403(admin, make_user):
    await _ok(await admin.post(f"{API}/auth/impersonate", json={"role": "FACULTY_EDITOR", "faculty_id": "ENG"}))
    viewer = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")
    response = await _patch(admin, viewer["id"], "FACULTY_EDITOR", "ENG")
    assert response.status_code == 403, response.text


async def test_requires_sign_in(client, make_user):
    viewer = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")
    assert (await _patch(client, viewer["id"], "FACULTY_EDITOR", "ENG")).status_code == 401


# --- Effect and audit ------------------------------------------------------

async def test_new_role_applies_to_the_next_request(admin, signed_in):
    viewer, user = await signed_in(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")
    assert (await _me(viewer))["role"] == "FACULTY_VIEWER"

    await _ok(await _patch(admin, user["id"], "FACULTY_EDITOR", "SCI"))

    me = await _me(viewer)
    assert (me["role"], me["faculty_id"]) == ("FACULTY_EDITOR", "SCI")


async def test_role_change_is_audited(admin, make_user):
    viewer = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG", email="jane@example.com")
    await _ok(await _patch(admin, viewer["id"], "FACULTY_EDITOR", "ENG"))

    async with async_session_maker() as session:
        logs = (await session.execute(
            select(ActivityLog).where(ActivityLog.action == "user.role_change")
        )).scalars().all()
    assert len(logs) == 1
    log = logs[0]
    assert (log.entity_type, log.entity_id, log.realm_key) == ("user", str(viewer["id"]), "UG")
    assert log.description == "Changed jane@example.com from FACULTY_VIEWER to FACULTY_EDITOR (faculty ENG)"
    assert log.extra == {
        "from_role": "FACULTY_VIEWER", "to_role": "FACULTY_EDITOR",
        "from_faculty_id": "ENG", "to_faculty_id": "ENG",
        "from_realm_key": "UG", "to_realm_key": "UG",
    }


async def test_no_change_writes_no_audit_log(admin, make_user, sent_emails):
    viewer = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")
    body = await _ok(await _patch(admin, viewer["id"], "FACULTY_VIEWER", "ENG"))
    assert body["role"] == "FACULTY_VIEWER"

    async with async_session_maker() as session:
        logs = (await session.execute(
            select(ActivityLog).where(ActivityLog.action == "user.role_change")
        )).scalars().all()
    assert logs == []
    assert await _notifications(viewer["id"]) == []
    assert sent_emails == []


# --- Telling the account holder --------------------------------------------

async def test_role_change_notifies_the_user_in_app_and_by_email(admin, make_user, sent_emails):
    viewer = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG", email="jane@example.com")
    await _ok(await _patch(admin, viewer["id"], "FACULTY_EDITOR", "ENG"))

    expected = (
        "Your role has been changed from Faculty Viewer to Faculty Editor for Engineering. "
        "The change applies the next time you use UniSchedule."
    )
    [notification] = await _notifications(viewer["id"])
    assert (notification.title, notification.message) == ("Your UniSchedule role has changed", expected)
    assert sent_emails == [(["jane@example.com"], "Your UniSchedule role has changed", expected)]


async def test_same_role_with_new_scope_says_access_was_updated(admin, make_user, sent_emails):
    editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")
    await _ok(await _patch(admin, editor["id"], "FACULTY_EDITOR", "SCI"))

    [notification] = await _notifications(editor["id"])
    assert notification.message.startswith("Your Faculty Editor access has been updated for Science.")


async def test_global_role_message_names_no_faculty(admin, make_user):
    editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")
    await _ok(await _patch(admin, editor["id"], "GS_ADMIN"))

    [notification] = await _notifications(editor["id"])
    assert notification.message.startswith("Your role has been changed from Faculty Editor to GS Admin. ")


async def test_a_mail_outage_does_not_undo_the_change(admin, make_user, monkeypatch):
    async def _fail(*args, **kwargs):
        raise ConnectionError("SMTP is down")

    monkeypatch.setattr(mail.EmailService, "send_generic_notification", staticmethod(_fail))
    viewer = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")

    body = await _ok(await _patch(admin, viewer["id"], "FACULTY_EDITOR", "ENG"))
    assert body["role"] == "FACULTY_EDITOR"
    assert (await _stored(viewer["id"])).role == RoleEnum.FACULTY_EDITOR
    assert len(await _notifications(viewer["id"])) == 1
