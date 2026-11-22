"""A Faculty Editor handing their editor access to a Faculty Viewer (/editor-access)."""
import pytest
from sqlalchemy import select

from core import mail
from core.database import async_session_maker
from modules.audit.models import ActivityLog
from modules.auth.models import RoleEnum, User
from modules.editor_access.models import EditorHandover
from modules.timetable.models import Faculty

API = "/api/v1"

GRANTED_TITLE = "You have been given Faculty Editor access"
RETRACTED_TITLE = "Your Faculty Editor access has been retracted"


async def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


async def _role(user_id: int) -> RoleEnum:
    async with async_session_maker() as session:
        return (await session.get(User, user_id)).role


async def _handovers() -> list[EditorHandover]:
    async with async_session_maker() as session:
        return (await session.execute(select(EditorHandover).order_by(EditorHandover.id))).scalars().all()


async def _logs(action: str) -> list[ActivityLog]:
    async with async_session_maker() as session:
        return (await session.execute(
            select(ActivityLog).where(ActivityLog.action == action).order_by(ActivityLog.id)
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
            Faculty(id="ENG", name="Faculty of Engineering", realm_key="UG"),
            Faculty(id="SCI", name="Faculty of Science", realm_key="UG"),
            Faculty(id="ICE-ENG", name="Faculty of Engineering", realm_key="ICE"),
        ])
        await session.commit()


@pytest.fixture
async def editor(make_client, make_user, login):
    """(client, user) for the original Faculty Editor of Engineering."""
    user = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG", email="a@unilag.edu.ng")
    client = make_client()
    await login(client, user["email"])
    return client, user


@pytest.fixture
async def viewer(make_user):
    return await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG", email="b@unilag.edu.ng")


@pytest.fixture
async def admin(signed_in):
    client, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    return client


def _grant(client, user_id: int):
    return client.post(f"{API}/editor-access/grant", json={"user_id": user_id})


def _retract(client, to_user_id: int | None = None):
    return client.post(f"{API}/editor-access/retract", json={"to_user_id": to_user_id})


async def _status(client) -> dict:
    return await _ok(await client.get(f"{API}/editor-access"))


async def _me(client) -> dict:
    return await _ok(await client.get(f"{API}/auth/me"))


# --- Granting ----------------------------------------------------------------

async def test_grant_swaps_the_two_roles(editor, viewer):
    client, me = editor
    await _ok(await _grant(client, viewer["id"]))

    assert await _role(viewer["id"]) == RoleEnum.FACULTY_EDITOR
    assert await _role(me["id"]) == RoleEnum.FACULTY_VIEWER
    # The editor's own session reflects it on the next request.
    assert (await _me(client))["role"] == "FACULTY_VIEWER"

    [handover] = await _handovers()
    assert (handover.granted_by_id, handover.holder_id, handover.faculty_id, handover.realm_key) == (
        me["id"], viewer["id"], "ENG", "UG",
    )
    assert handover.started_at is not None and handover.ended_at is None


async def test_the_new_editor_can_do_what_a_faculty_editor_does(editor, viewer, make_client, login):
    client, _ = editor
    await _ok(await _grant(client, viewer["id"]))

    holder = make_client()
    await login(holder, viewer["email"])
    me = await _me(holder)
    assert (me["role"], me["faculty_id"]) == ("FACULTY_EDITOR", "ENG")
    # e.g. the faculty's staff list, which only editors may read.
    await _ok(await holder.get(f"{API}/auth/users"))


async def test_grant_is_logged(editor, viewer):
    client, me = editor
    await _ok(await _grant(client, viewer["id"]))

    [log] = await _logs("editor_access.grant")
    assert (log.user_id, log.user_email, log.user_role, log.realm_key) == (
        me["id"], "a@unilag.edu.ng", "FACULTY_EDITOR", "UG",
    )
    assert log.created_at is not None
    assert log.description == (
        "Faculty Editor a@unilag.edu.ng granted editor access to b@unilag.edu.ng (Faculty of Engineering)"
    )
    assert log.extra["gained"] == {"id": viewer["id"], "email": "b@unilag.edu.ng"}
    assert log.extra["lost"] == {"id": me["id"], "email": "a@unilag.edu.ng"}
    assert (log.extra["faculty_id"], log.extra["faculty_name"], log.extra["realm_key"]) == (
        "ENG", "Faculty of Engineering", "UG",
    )


async def test_grant_emails_the_person_who_gains_access(editor, viewer, sent_emails):
    client, _ = editor
    await _ok(await _grant(client, viewer["id"]))

    [(recipients, title, message)] = sent_emails
    assert (recipients, title) == (["b@unilag.edu.ng"], GRANTED_TITLE)
    assert "a@unilag.edu.ng has given you Faculty Editor access for Faculty of Engineering" in message


async def test_a_mail_outage_does_not_undo_the_grant(editor, viewer, monkeypatch):
    async def _fail(*args, **kwargs):
        raise ConnectionError("SMTP is down")

    monkeypatch.setattr(mail.EmailService, "send_generic_notification", staticmethod(_fail))
    client, me = editor
    await _ok(await _grant(client, viewer["id"]))
    assert await _role(viewer["id"]) == RoleEnum.FACULTY_EDITOR
    assert await _role(me["id"]) == RoleEnum.FACULTY_VIEWER


async def test_status_lists_only_viewers_of_the_editors_faculty(editor, viewer, make_user):
    client, _ = editor
    await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="SCI")
    await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ICE-ENG", realm="ICE")
    await make_user(RoleEnum.DEO, faculty_id="ENG")
    await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")

    status = await _status(client)
    assert status["can_grant"] is True
    assert (status["granted"], status["received"]) == (None, None)
    assert status["candidates"] == [{"id": viewer["id"], "email": "b@unilag.edu.ng"}]


# --- Granting: refusals ------------------------------------------------------

async def _assert_nothing_changed(editor_id: int, other_id: int, other_role: RoleEnum):
    assert await _role(editor_id) == RoleEnum.FACULTY_EDITOR
    assert await _role(other_id) == other_role
    assert await _handovers() == []
    assert await _logs("editor_access.grant") == []


async def test_cannot_grant_to_a_viewer_in_another_faculty(editor, make_user):
    client, me = editor
    other = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="SCI")
    assert (await _grant(client, other["id"])).status_code == 404
    await _assert_nothing_changed(me["id"], other["id"], RoleEnum.FACULTY_VIEWER)


async def test_cannot_grant_to_a_viewer_in_another_realm(editor, make_user):
    client, me = editor
    other = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ICE-ENG", realm="ICE")
    assert (await _grant(client, other["id"])).status_code == 404
    await _assert_nothing_changed(me["id"], other["id"], RoleEnum.FACULTY_VIEWER)


async def test_same_faculty_id_in_another_realm_is_refused(editor, make_user):
    # Faculty ids are unique across realms, but a stray account must not slip through.
    client, me = editor
    other = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG", realm="ICE")
    assert (await _grant(client, other["id"])).status_code == 404
    await _assert_nothing_changed(me["id"], other["id"], RoleEnum.FACULTY_VIEWER)


@pytest.mark.parametrize("role", [RoleEnum.DEO, RoleEnum.FACULTY_EDITOR])
async def test_cannot_grant_to_someone_who_is_not_a_viewer(editor, make_user, role):
    client, me = editor
    other = await make_user(role, faculty_id="ENG")
    response = await _grant(client, other["id"])
    assert response.status_code == 400, response.text
    await _assert_nothing_changed(me["id"], other["id"], role)


async def test_cannot_grant_to_a_missing_account(editor):
    client, _ = editor
    assert (await _grant(client, 9999)).status_code == 404


@pytest.mark.parametrize("role, faculty_id", [
    (RoleEnum.FACULTY_VIEWER, "ENG"),
    (RoleEnum.DEO, "ENG"),
    (RoleEnum.SUPER_ADMIN, None),
    (RoleEnum.GS_ADMIN, None),
])
async def test_only_a_faculty_editor_can_grant(signed_in, viewer, role, faculty_id):
    client, user = await signed_in(role, faculty_id=faculty_id)
    assert (await _grant(client, viewer["id"])).status_code == 403
    assert await _role(viewer["id"]) == RoleEnum.FACULTY_VIEWER
    assert await _role(user["id"]) == role


async def test_super_admin_acting_as_editor_cannot_grant(admin, viewer):
    await _ok(await admin.post(f"{API}/auth/impersonate", json={"role": "FACULTY_EDITOR", "faculty_id": "ENG"}))
    assert (await _grant(admin, viewer["id"])).status_code == 403
    assert await _role(viewer["id"]) == RoleEnum.FACULTY_VIEWER
    assert await _handovers() == []


async def test_the_new_editor_cannot_hand_the_access_on(editor, viewer, make_user, make_client, login):
    client, me = editor
    await _ok(await _grant(client, viewer["id"]))
    third = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")

    holder = make_client()
    await login(holder, viewer["email"])
    status = await _status(holder)
    assert status["can_grant"] is False
    assert status["received"]["granted_by"]["email"] == "a@unilag.edu.ng"
    assert status["candidates"] == []

    response = await _grant(holder, third["id"])
    assert response.status_code == 403, response.text
    assert "can't hand it on" in response.json()["detail"]
    assert await _role(third["id"]) == RoleEnum.FACULTY_VIEWER
    assert await _role(viewer["id"]) == RoleEnum.FACULTY_EDITOR
    assert len(await _handovers()) == 1


async def test_cannot_grant_to_an_editor_who_has_handed_over_their_own(editor, viewer, make_user, make_client, login):
    client, me = editor
    await _ok(await _grant(client, viewer["id"]))

    # A second editor of the faculty tries to give their access to the first,
    # who is a Faculty Viewer only while their own access is handed over.
    other_editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ENG")
    other = make_client()
    await login(other, other_editor["email"])
    assert me["id"] not in [c["id"] for c in (await _status(other))["candidates"]]
    response = await _grant(other, me["id"])
    assert response.status_code == 400, response.text
    assert await _role(me["id"]) == RoleEnum.FACULTY_VIEWER
    assert await _role(other_editor["id"]) == RoleEnum.FACULTY_EDITOR


# --- Retracting --------------------------------------------------------------

async def test_status_while_handed_over_offers_the_retract_options(editor, viewer, make_user):
    client, _ = editor
    await _ok(await _grant(client, viewer["id"]))
    third = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG", email="c@unilag.edu.ng")

    status = await _status(client)
    assert status["can_grant"] is False
    assert status["granted"]["holder"] == {"id": viewer["id"], "email": "b@unilag.edu.ng"}
    assert status["granted"]["faculty_name"] == "Faculty of Engineering"
    assert status["candidates"] == [{"id": third["id"], "email": "c@unilag.edu.ng"}]


async def test_retract_back_to_self(editor, viewer, sent_emails):
    client, me = editor
    await _ok(await _grant(client, viewer["id"]))
    sent_emails.clear()

    await _ok(await _retract(client))

    assert await _role(me["id"]) == RoleEnum.FACULTY_EDITOR
    assert await _role(viewer["id"]) == RoleEnum.FACULTY_VIEWER
    assert (await _me(client))["role"] == "FACULTY_EDITOR"
    [handover] = await _handovers()
    assert (handover.end_reason, handover.ended_by_id) == ("returned", me["id"])
    assert handover.ended_at is not None

    [log] = await _logs("editor_access.retract")
    assert (log.user_email, log.realm_key) == ("a@unilag.edu.ng", "UG")
    assert log.description == (
        "a@unilag.edu.ng retracted the editor access they gave b@unilag.edu.ng "
        "and is Faculty Editor again (Faculty of Engineering)"
    )
    assert log.extra["outcome"] == "returned"
    assert log.extra["gained"]["email"] == "a@unilag.edu.ng"
    assert log.extra["lost"]["email"] == "b@unilag.edu.ng"

    [(recipients, title, message)] = sent_emails
    assert (recipients, title) == (["b@unilag.edu.ng"], RETRACTED_TITLE)
    assert "You are back to Faculty Viewer" in message

    # And the editor can hand it over again.
    assert (await _status(client))["can_grant"] is True


async def test_passing_your_own_id_also_returns_the_access(editor, viewer):
    client, me = editor
    await _ok(await _grant(client, viewer["id"]))
    await _ok(await _retract(client, me["id"]))
    assert await _role(me["id"]) == RoleEnum.FACULTY_EDITOR
    assert await _role(viewer["id"]) == RoleEnum.FACULTY_VIEWER


async def test_redirect_to_another_viewer(editor, viewer, make_user, sent_emails):
    client, me = editor
    await _ok(await _grant(client, viewer["id"]))
    third = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG", email="c@unilag.edu.ng")
    sent_emails.clear()

    await _ok(await _retract(client, third["id"]))

    assert await _role(me["id"]) == RoleEnum.FACULTY_VIEWER
    assert await _role(viewer["id"]) == RoleEnum.FACULTY_VIEWER
    assert await _role(third["id"]) == RoleEnum.FACULTY_EDITOR

    old, new = await _handovers()
    assert (old.holder_id, old.end_reason) == (viewer["id"], "redirected")
    assert (new.granted_by_id, new.holder_id, new.ended_at) == (me["id"], third["id"], None)

    [log] = await _logs("editor_access.retract")
    assert log.description == (
        "a@unilag.edu.ng retracted the editor access they gave b@unilag.edu.ng "
        "and gave it to c@unilag.edu.ng (Faculty of Engineering)"
    )
    assert log.extra["outcome"] == "redirected"
    assert log.extra["lost"] == {"id": viewer["id"], "email": "b@unilag.edu.ng"}
    assert log.extra["gained"] == {"id": third["id"], "email": "c@unilag.edu.ng"}

    assert sorted((r, t) for r, t, _ in sent_emails) == [
        (["b@unilag.edu.ng"], RETRACTED_TITLE),
        (["c@unilag.edu.ng"], GRANTED_TITLE),
    ]

    # Still only the original editor can take it back, now from the new holder.
    await _ok(await _retract(client))
    assert await _role(me["id"]) == RoleEnum.FACULTY_EDITOR
    assert await _role(third["id"]) == RoleEnum.FACULTY_VIEWER


async def test_cannot_redirect_to_a_viewer_in_another_faculty(editor, viewer, make_user):
    client, me = editor
    await _ok(await _grant(client, viewer["id"]))
    other = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="SCI")

    assert (await _retract(client, other["id"])).status_code == 404
    assert await _role(viewer["id"]) == RoleEnum.FACULTY_EDITOR
    assert await _role(other["id"]) == RoleEnum.FACULTY_VIEWER
    assert await _logs("editor_access.retract") == []


async def test_cannot_redirect_to_the_current_holder(editor, viewer):
    client, _ = editor
    await _ok(await _grant(client, viewer["id"]))
    assert (await _retract(client, viewer["id"])).status_code == 400
    assert await _role(viewer["id"]) == RoleEnum.FACULTY_EDITOR


async def test_retract_by_someone_who_did_not_grant(editor, viewer, make_user, make_client, login):
    client, me = editor
    await _ok(await _grant(client, viewer["id"]))

    # Another Faculty Viewer of the faculty.
    bystander = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")
    other = make_client()
    await login(other, bystander["email"])
    assert (await _retract(other)).status_code == 404
    assert (await _retract(other, bystander["id"])).status_code == 404

    # The holder (a Faculty Editor) can't hand it back or on through retract either.
    holder = make_client()
    await login(holder, viewer["email"])
    assert (await _retract(holder)).status_code == 403

    assert await _role(viewer["id"]) == RoleEnum.FACULTY_EDITOR
    assert await _role(me["id"]) == RoleEnum.FACULTY_VIEWER
    assert await _role(bystander["id"]) == RoleEnum.FACULTY_VIEWER
    assert await _logs("editor_access.retract") == []


async def test_retract_with_nothing_handed_over_is_404(signed_in):
    client, _ = await signed_in(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")
    assert (await _retract(client)).status_code == 404


# --- Heads of Department (HOD) never receive editor access -------------------

@pytest.fixture
async def hod(make_user):
    return await make_user(RoleEnum.HOD, faculty_id="ENG", email="hod@unilag.edu.ng")


async def test_an_hod_is_never_offered_to_grant_to(editor, viewer, hod):
    client, _ = editor
    status = await _status(client)
    assert status["can_grant"] is True
    assert status["candidates"] == [{"id": viewer["id"], "email": "b@unilag.edu.ng"}]


async def test_cannot_grant_to_an_hod(editor, hod):
    client, me = editor
    response = await _grant(client, hod["id"])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Editor access can't be given to a Faculty Viewer (HOD)"
    await _assert_nothing_changed(me["id"], hod["id"], RoleEnum.HOD)


async def test_an_hod_is_never_offered_to_redirect_to(editor, viewer, hod):
    client, _ = editor
    await _ok(await _grant(client, viewer["id"]))
    assert (await _status(client))["candidates"] == []


async def test_cannot_redirect_to_an_hod(editor, viewer, hod):
    client, me = editor
    await _ok(await _grant(client, viewer["id"]))

    response = await _retract(client, hod["id"])
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Editor access can't be given to a Faculty Viewer (HOD)"
    assert await _role(viewer["id"]) == RoleEnum.FACULTY_EDITOR
    assert await _role(me["id"]) == RoleEnum.FACULTY_VIEWER
    assert await _role(hod["id"]) == RoleEnum.HOD
    [handover] = await _handovers()
    assert (handover.holder_id, handover.ended_at) == (viewer["id"], None)
    assert await _logs("editor_access.retract") == []


async def test_an_hod_has_no_handover_controls(hod, viewer, make_client, login):
    client = make_client()
    await login(client, hod["email"])
    assert await _status(client) == {"can_grant": False, "granted": None, "received": None, "candidates": []}
    assert (await _grant(client, viewer["id"])).status_code == 403
    assert (await _retract(client, viewer["id"])).status_code == 403
    assert await _role(viewer["id"]) == RoleEnum.FACULTY_VIEWER


async def test_a_plain_viewer_sees_no_handover_controls(signed_in, viewer):
    client, _ = await signed_in(RoleEnum.FACULTY_VIEWER, faculty_id="ENG")
    assert await _status(client) == {"can_grant": False, "granted": None, "received": None, "candidates": []}


# --- Super admin -------------------------------------------------------------

async def test_super_admin_lists_and_reverses_a_handover(editor, viewer, admin, sent_emails):
    client, me = editor
    await _ok(await _grant(client, viewer["id"]))
    sent_emails.clear()

    [listed] = await _ok(await admin.get(f"{API}/editor-access/handovers"))
    assert (listed["faculty_name"], listed["granted_by"]["email"], listed["holder"]["email"]) == (
        "Faculty of Engineering", "a@unilag.edu.ng", "b@unilag.edu.ng",
    )

    await _ok(await admin.post(f"{API}/editor-access/handovers/{listed['id']}/reverse"))

    assert await _role(me["id"]) == RoleEnum.FACULTY_EDITOR
    assert await _role(viewer["id"]) == RoleEnum.FACULTY_VIEWER
    [handover] = await _handovers()
    assert handover.end_reason == "reversed_by_admin"
    assert await _ok(await admin.get(f"{API}/editor-access/handovers")) == []

    [log] = await _logs("editor_access.reverse_by_admin")
    assert log.user_role == "SUPER_ADMIN"
    assert log.description == (
        f"Super Admin {log.user_email} reversed the editor access handover in Faculty of Engineering: "
        "a@unilag.edu.ng is Faculty Editor again and b@unilag.edu.ng is back to Faculty Viewer"
    )

    by_recipient = {tuple(r): (t, m) for r, t, m in sent_emails}
    assert by_recipient[("b@unilag.edu.ng",)][1].startswith("A Super Admin has reversed the editing roles")
    assert "Your editing rights have been restored" in by_recipient[("a@unilag.edu.ng",)][1]

    # Already over.
    assert (await admin.post(f"{API}/editor-access/handovers/{listed['id']}/reverse")).status_code == 404


async def test_handovers_in_another_realm_are_hidden_from_the_admin(signed_in, make_user, make_client, login):
    ice_editor = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ICE-ENG", realm="ICE")
    ice_viewer = await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="ICE-ENG", realm="ICE")
    client = make_client()
    await login(client, ice_editor["email"])
    await _ok(await _grant(client, ice_viewer["id"]))
    [handover] = await _handovers()
    assert handover.realm_key == "ICE"

    ug_admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    assert await _ok(await ug_admin.get(f"{API}/editor-access/handovers")) == []
    assert (await ug_admin.post(f"{API}/editor-access/handovers/{handover.id}/reverse")).status_code == 404
    assert await _role(ice_viewer["id"]) == RoleEnum.FACULTY_EDITOR


@pytest.mark.parametrize("role, faculty_id", [
    (RoleEnum.FACULTY_EDITOR, "ENG"),
    (RoleEnum.SUPER_VIEWER, None),
    (RoleEnum.CITS_ADMIN, None),
])
async def test_only_a_super_admin_can_reverse(editor, viewer, signed_in, role, faculty_id):
    client, _ = editor
    await _ok(await _grant(client, viewer["id"]))
    [handover] = await _handovers()

    other, _ = await signed_in(role, faculty_id=faculty_id)
    assert (await other.get(f"{API}/editor-access/handovers")).status_code == 403
    assert (await other.post(f"{API}/editor-access/handovers/{handover.id}/reverse")).status_code == 403
    assert await _role(viewer["id"]) == RoleEnum.FACULTY_EDITOR


@pytest.mark.parametrize("person", ["original_editor", "holder"])
async def test_role_change_or_delete_is_refused_during_a_handover(editor, viewer, admin, person):
    client, me = editor
    await _ok(await _grant(client, viewer["id"]))
    user_id = me["id"] if person == "original_editor" else viewer["id"]
    role = await _role(user_id)

    response = await admin.patch(f"{API}/auth/users/{user_id}", json={"role": "GS_ADMIN"})
    assert response.status_code == 409, response.text
    assert "Reverse the handover first" in response.json()["detail"]
    assert (await admin.delete(f"{API}/auth/users/{user_id}")).status_code == 409
    assert await _role(user_id) == role

    # Once reversed, both work again.
    [handover] = await _handovers()
    await _ok(await admin.post(f"{API}/editor-access/handovers/{handover.id}/reverse"))
    await _ok(await admin.patch(f"{API}/auth/users/{user_id}", json={"role": "GS_ADMIN"}))
    await _ok(await admin.delete(f"{API}/auth/users/{user_id}"))
