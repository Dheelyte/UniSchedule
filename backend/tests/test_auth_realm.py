"""Login, tokens, impersonation, invitations and staff listings per realm (ICE realm phase 2)."""
import pytest
from sqlalchemy import select, update

from core import mail
from core.database import async_session_maker
from core.security import create_access_token
from main import lifespan, app
from modules.audit.models import ActivityLog
from modules.auth.models import Invitation, RoleEnum, User
from modules.realms.defaults import ICE_CONFIG, UG_CONFIG

API = "/api/v1"
NEW_PASSWORD = "Password123"


async def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


async def _me(client) -> dict:
    return await _ok(await client.get(f"{API}/auth/me"))


@pytest.fixture
async def signed_in(make_client, make_user, login):
    """Factory: create a user and return (client signed in as them, user)."""

    async def _signed_in(role, *, realm="UG", login_realm=None, faculty_id=None):
        user = await make_user(role, faculty_id=faculty_id, realm=realm)
        client = make_client()
        await login(client, user["email"], realm=login_realm)
        return client, user

    return _signed_in


# --- Login -----------------------------------------------------------------

async def test_realm_bound_user_logs_in_to_own_portal_only(client, make_user, login):
    editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG", realm="ICE")

    response = await client.post(
        f"{API}/auth/login", json={"email": editor["email"], "password": editor["password"], "realm": "UG"}
    )
    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "This account belongs to the ICE portal."
    assert (await client.get(f"{API}/auth/me")).status_code == 401

    await login(client, editor["email"], realm="ICE")
    assert (await _me(client))["realm"] == "ICE"


async def test_ug_user_is_refused_at_the_ice_portal(client, make_user):
    editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")
    response = await client.post(
        f"{API}/auth/login", json={"email": editor["email"], "password": editor["password"], "realm": "ICE"}
    )
    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "This account belongs to the Undergraduate portal."


async def test_login_without_realm_uses_own_realm_or_ug(signed_in):
    ice_editor, _ = await signed_in(RoleEnum.FACULTY_EDITOR, realm="ICE", faculty_id="ENG")
    ug_editor, _ = await signed_in(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)

    assert (await _me(ice_editor))["realm"] == "ICE"
    me = await _me(ug_editor)
    assert (me["realm"], me["realm_name"], me["realm_config"]) == ("UG", "Undergraduate", UG_CONFIG)
    assert (await _me(admin))["realm"] == "UG"


async def test_login_to_unknown_realm_is_400(client, make_user):
    for role in (RoleEnum.SUPER_ADMIN, RoleEnum.FACULTY_EDITOR):
        user = await make_user(role)
        response = await client.post(
            f"{API}/auth/login", json={"email": user["email"], "password": user["password"], "realm": "NOPE"}
        )
        assert response.status_code == 400, response.text


async def test_wrong_password_is_401_whatever_the_realm(client, make_user):
    editor = await make_user(RoleEnum.FACULTY_EDITOR, realm="ICE")
    response = await client.post(
        f"{API}/auth/login", json={"email": editor["email"], "password": "wrong", "realm": "UG"}
    )
    assert response.status_code == 401


async def test_super_admin_logs_in_to_ice_before_it_is_live(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN, login_realm="ICE")
    me = await _me(admin)
    assert me["realm"] == "ICE"
    assert me["realm_name"] == "ICE"
    assert me["realm_config"] == ICE_CONFIG


# --- Tokens and the current user -------------------------------------------

@pytest.mark.parametrize("role", [RoleEnum.SUPER_ADMIN, RoleEnum.FACULTY_EDITOR])
async def test_token_from_before_realms_still_works_in_ug(client, make_user, role):
    user = await make_user(role)
    client.cookies.set("access_token", create_access_token(data={
        "sub": str(user["id"]), "email": user["email"], "role": user["role"], "faculty_id": None,
    }))
    assert (await _me(client))["realm"] == "UG"
    assert (await client.get(f"{API}/timetable/courses")).status_code == 200


async def test_editor_moved_to_ice_is_in_ice_on_the_next_request(signed_in):
    editor, user = await signed_in(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")
    assert (await _me(editor))["realm"] == "UG"

    async with async_session_maker() as session:
        await session.execute(update(User).where(User.id == user["id"]).values(realm_key="ICE"))
        await session.commit()

    assert (await _me(editor))["realm"] == "ICE"


async def test_realm_bound_user_cannot_forge_a_realm_claim(client, make_user):
    editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")
    client.cookies.set("access_token", create_access_token(data={"sub": str(editor["id"]), "realm": "ICE"}))
    assert (await _me(client))["realm"] == "UG"


async def test_cross_realm_token_for_a_missing_realm_is_401(client, make_user):
    admin = await make_user(RoleEnum.SUPER_ADMIN)
    client.cookies.set("access_token", create_access_token(data={"sub": str(admin["id"]), "realm": "NOPE"}))
    assert (await client.get(f"{API}/auth/me")).status_code == 401


# --- Switching realm -------------------------------------------------------

async def test_super_admin_switches_realm(signed_in):
    admin, user = await signed_in(RoleEnum.SUPER_ADMIN)

    body = await _ok(await admin.post(f"{API}/auth/switch-realm", json={"realm": "ICE"}))
    assert body["realm"] == "ICE"
    me = await _me(admin)
    assert (me["realm"], me["realm_config"], me["role"]) == ("ICE", ICE_CONFIG, "SUPER_ADMIN")

    await _ok(await admin.post(f"{API}/auth/switch-realm", json={"realm": "UG"}))
    assert (await _me(admin))["realm"] == "UG"

    assert (await admin.post(f"{API}/auth/switch-realm", json={"realm": "NOPE"})).status_code == 400
    assert (await _me(admin))["realm"] == "UG"

    async with async_session_maker() as session:
        logs = (await session.execute(
            select(ActivityLog).where(ActivityLog.action == "auth.switch_realm").order_by(ActivityLog.id)
        )).scalars().all()
    assert [(log.user_id, log.extra) for log in logs] == [
        (user["id"], {"from_realm": "UG", "to_realm": "ICE"}),
        (user["id"], {"from_realm": "ICE", "to_realm": "UG"}),
    ]


@pytest.mark.parametrize("role", [RoleEnum.SUPER_VIEWER, RoleEnum.CITS_ADMIN])
async def test_other_cross_realm_roles_can_switch(signed_in, role):
    client, _ = await signed_in(role)
    await _ok(await client.post(f"{API}/auth/switch-realm", json={"realm": "ICE"}))
    assert (await _me(client))["realm"] == "ICE"


@pytest.mark.parametrize("role", [RoleEnum.FACULTY_EDITOR, RoleEnum.FACULTY_VIEWER, RoleEnum.GS_ADMIN])
async def test_realm_bound_roles_cannot_switch(signed_in, role):
    client, _ = await signed_in(role, faculty_id="ENG")
    assert (await client.post(f"{API}/auth/switch-realm", json={"realm": "ICE"})).status_code == 403
    assert (await _me(client))["realm"] == "UG"


async def test_switch_realm_requires_sign_in(client):
    assert (await client.post(f"{API}/auth/switch-realm", json={"realm": "ICE"})).status_code == 401


# --- Impersonation ---------------------------------------------------------

async def test_impersonation_keeps_the_realm(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN, login_realm="ICE")

    # GS_ADMIN is realm-bound, yet the realm follows the real (cross-realm) account.
    await _ok(await admin.post(f"{API}/auth/impersonate", json={"role": "GS_ADMIN"}))
    me = await _me(admin)
    assert (me["role"], me["impersonating"], me["realm"]) == ("GS_ADMIN", True, "ICE")

    await _ok(await admin.post(f"{API}/auth/impersonate/stop"))
    me = await _me(admin)
    assert (me["role"], me["impersonating"], me["realm"]) == ("SUPER_ADMIN", False, "ICE")


async def test_switching_realm_ends_impersonation(signed_in):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    await _ok(await admin.post(f"{API}/auth/impersonate", json={"role": "GS_ADMIN"}))

    await _ok(await admin.post(f"{API}/auth/switch-realm", json={"realm": "ICE"}))
    me = await _me(admin)
    assert (me["role"], me["impersonating"], me["realm"]) == ("SUPER_ADMIN", False, "ICE")


# --- Invitations and registration ------------------------------------------

@pytest.fixture
def sent_invites(monkeypatch):
    """Capture invitation emails instead of sending them."""
    sent: list[dict] = []

    async def _capture(**kwargs):
        sent.append(kwargs)

    monkeypatch.setattr(mail.EmailService, "send_invitation_email", staticmethod(_capture))
    return sent


async def _invite_and_register(admin, client, email: str, role: str) -> dict:
    token = (await _ok(await admin.post(f"{API}/auth/invite", json={"email": email, "target_role": role})))["token"]
    async with async_session_maker() as session:
        invite = (await session.execute(select(Invitation).where(Invitation.token == token))).scalar_one()
        invite_realm = invite.realm_key
    user_id = (await _ok(await client.post(f"{API}/auth/register/{token}", json={"password": NEW_PASSWORD})))["user_id"]
    async with async_session_maker() as session:
        user = await session.get(User, user_id)
        return {"invite_realm": invite_realm, "user_realm": user.realm_key}


async def test_invite_from_ice_registers_an_ice_user(signed_in, client, login, sent_invites):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN, login_realm="ICE")

    result = await _invite_and_register(admin, client, "ice-editor@example.com", "FACULTY_EDITOR")
    assert result == {"invite_realm": "ICE", "user_realm": "ICE"}
    assert sent_invites[0]["realm_key"] == "ICE"
    assert sent_invites[0]["realm_name"] == "ICE"

    await login(client, "ice-editor@example.com", NEW_PASSWORD)
    assert (await _me(client))["realm"] == "ICE"


async def test_invite_from_ug_registers_a_ug_user(signed_in, client, sent_invites):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    result = await _invite_and_register(admin, client, "ug-editor@example.com", "FACULTY_EDITOR")
    assert result == {"invite_realm": "UG", "user_realm": "UG"}
    assert sent_invites[0]["realm_name"] == "Undergraduate"


async def test_cross_realm_invite_has_no_realm(signed_in, client, sent_invites):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN, login_realm="ICE")
    result = await _invite_and_register(admin, client, "viewer@example.com", "SUPER_VIEWER")
    assert result == {"invite_realm": None, "user_realm": None}
    # The link still names a portal: the one the inviter was working in.
    assert sent_invites[0]["realm_key"] == "ICE"


async def test_invitation_link_carries_the_realm(capsys):
    await mail.EmailService.send_invitation_email(
        recipient_email="someone@example.com", token="abc", role="FACULTY_EDITOR", realm_key="ICE", realm_name="ICE",
    )
    assert "/register?token=abc&realm=ICE" in capsys.readouterr().out


# --- Staff listings --------------------------------------------------------

async def test_staff_listing_is_per_realm(signed_in, make_user, sent_invites):
    admin, admin_user = await signed_in(RoleEnum.SUPER_ADMIN)
    ug_editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")
    ice_editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG", realm="ICE")
    viewer = await make_user(RoleEnum.SUPER_VIEWER)

    async def emails(path: str) -> set[str]:
        return {row["email"] for row in await _ok(await admin.get(f"{API}/auth/{path}"))}

    await _ok(await admin.post(f"{API}/auth/invite", json={"email": "ug-invite@example.com", "target_role": "GS_ADMIN"}))
    await _ok(await admin.post(f"{API}/auth/invite", json={"email": "all-invite@example.com", "target_role": "CITS_ADMIN"}))

    shared = {admin_user["email"], viewer["email"]}
    assert await emails("users") == shared | {ug_editor["email"]}
    assert await emails("invitations") == {"ug-invite@example.com", "all-invite@example.com"}
    users = {row["email"]: row for row in await _ok(await admin.get(f"{API}/auth/users"))}
    assert users[ug_editor["email"]]["realm_key"] == "UG"
    assert users[viewer["email"]]["realm_key"] is None

    await _ok(await admin.post(f"{API}/auth/switch-realm", json={"realm": "ICE"}))
    await _ok(await admin.post(f"{API}/auth/invite", json={"email": "ice-invite@example.com", "target_role": "GS_ADMIN"}))

    assert await emails("users") == shared | {ice_editor["email"]}
    assert await emails("invitations") == {"ice-invite@example.com", "all-invite@example.com"}


async def test_cross_realm_account_with_a_stale_realm_is_listed_everywhere(signed_in, make_user):
    """Accounts made between phases 1 and 2 got realm_key 'UG' even for cross-realm roles."""
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN, login_realm="ICE")
    viewer = await make_user(RoleEnum.SUPER_VIEWER)
    async with async_session_maker() as session:
        await session.execute(update(User).where(User.id == viewer["id"]).values(realm_key="UG"))
        await session.commit()

    listed = {row["email"] for row in await _ok(await admin.get(f"{API}/auth/users"))}
    assert viewer["email"] in listed


async def test_deletes_are_limited_to_the_active_realm(signed_in, make_user, sent_invites):
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    ug_editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")
    viewer = await make_user(RoleEnum.SUPER_VIEWER)
    await _ok(await admin.post(f"{API}/auth/invite", json={"email": "ug-invite@example.com", "target_role": "GS_ADMIN"}))
    ug_invite_id = (await _ok(await admin.get(f"{API}/auth/invitations")))[0]["id"]

    await _ok(await admin.post(f"{API}/auth/switch-realm", json={"realm": "ICE"}))
    assert (await admin.delete(f"{API}/auth/users/{ug_editor['id']}")).status_code == 404
    assert (await admin.delete(f"{API}/auth/invitations/{ug_invite_id}")).status_code == 404
    # Cross-realm accounts belong to every realm's list.
    assert (await admin.delete(f"{API}/auth/users/{viewer['id']}")).status_code == 200

    await _ok(await admin.post(f"{API}/auth/switch-realm", json={"realm": "UG"}))
    assert (await admin.delete(f"{API}/auth/users/{ug_editor['id']}")).status_code == 200
    assert (await admin.delete(f"{API}/auth/invitations/{ug_invite_id}")).status_code == 200


# --- Seeded super admin ----------------------------------------------------

async def test_seeded_super_admin_has_no_realm():
    async with lifespan(app):
        pass
    async with async_session_maker() as session:
        admins = (await session.execute(select(User).where(User.role == RoleEnum.SUPER_ADMIN))).scalars().all()
    assert [admin.realm_key for admin in admins] == [None]


# --- Temporary guard: unscoped routers are UG only until phase 3 -----------

GUARDED = [
    "/calendar/sessions",
    "/calendar/semesters/current",
    "/timetable/courses",
    "/timetable/schedule-items",
    "/notifications",
    "/audit/logs",
    "/export/timetable?session_id=1&semester_id=1",
]


async def test_ice_sessions_cannot_reach_ug_data(signed_in):
    ice_editor, _ = await signed_in(RoleEnum.FACULTY_EDITOR, realm="ICE", faculty_id="ENG")
    ice_admin, _ = await signed_in(RoleEnum.SUPER_ADMIN, login_realm="ICE")

    for client in (ice_editor, ice_admin):
        for path in GUARDED:
            response = await client.get(f"{API}{path}")
            assert response.status_code == 403, f"{path}: {response.status_code} {response.text}"
            assert response.json()["detail"] == "The ICE portal isn't available yet."

    response = await ice_admin.post(f"{API}/calendar/sessions", json={"name": "2025/2026"})
    assert response.status_code == 403, response.text

    # Realm-aware endpoints stay open.
    assert (await ice_admin.get(f"{API}/realms")).status_code == 200
    assert (await ice_admin.get(f"{API}/auth/users")).status_code == 200


async def test_guard_leaves_ug_and_signed_out_requests_alone(client, signed_in):
    ug_admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    signed_out = {path: (await client.get(f"{API}{path}")).status_code for path in GUARDED}
    assert 403 not in signed_out.values()

    for path in GUARDED:
        response = await ug_admin.get(f"{API}{path}")
        assert response.status_code == 200, f"{path}: {response.status_code} {response.text}"
