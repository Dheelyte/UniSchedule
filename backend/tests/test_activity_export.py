"""The Activity Logs export: impersonation pairing, Members, the analysis sections,
and the preview / export / analysis / rows endpoints (SUPER_ADMIN only)."""
from datetime import date, datetime, timedelta, timezone

import pytest

from modules.audit.filters import AuditFilters, earliest_export_start, filters_to_query, lagos_today, parse_filters
from modules.audit.impersonation import (
    ENDED_BY_NEW_START,
    ENDED_BY_PORTAL_SWITCH,
    ENDED_BY_STOP,
    START,
    STOP,
    SWITCH,
    Event,
    attach_actions,
    pair_sessions,
)
from modules.audit.members import (
    FLAG_EXPIRED,
    FLAG_INACTIVE_30,
    FLAG_INACTIVE_90,
    FLAG_NEVER,
    FLAG_PENDING,
    VIA_SIGN_IN,
    VIA_SWITCH,
    Account,
    Activity,
    InviteEntry,
    Logins,
    MemberFacts,
    OpenInvitation,
    build_members,
)
from modules.auth.models import Invitation, RoleEnum
from modules.calendar.models import AcademicSession, Semester
from modules.editor_access.models import EditorHandover
from modules.timetable.models import BlockedSlot, Faculty
from tests.test_activity_filters import API, add, add_logs, custom, lagos

PREVIEW = f"{API}/audit/export/preview"
EXPORT = f"{API}/audit/export"
ANALYSIS = f"{API}/audit/export/analysis"
ROWS = f"{API}/audit/export/rows"
ALL_SECTIONS = [
    "summary", "categories", "users", "roles_portals", "over_time",
    "out_of_hours", "unusual", "impersonation", "sensitive", "handovers", "locks", "courses",
    "change_requests", "exports", "members", "raw",
]
MARCH = {"range": "custom", "from": "2026-03-01", "to": "2026-03-31"}


@pytest.fixture
async def admin(signed_in):
    client, user = await signed_in(RoleEnum.SUPER_ADMIN)
    return client


async def start(client, filters=None, *, fmt="xlsx", sections=None, mask=False, expect=200):
    response = await client.post(EXPORT, json={
        "filters": filters if filters is not None else MARCH,
        "format": fmt,
        "sections": sections or ALL_SECTIONS,
        "mask_emails": mask,
    })
    assert response.status_code == expect, response.text
    return response.json()


async def analysis(client, token):
    response = await client.get(ANALYSIS, headers={"X-Export-Token": token})
    assert response.status_code == 200, response.text
    return response.json()


async def all_rows(client, token, limit=5000):
    rows, after, pages = [], None, 0
    while True:
        params = {"limit": limit, **({"after": after} if after else {})}
        response = await client.get(ROWS, params=params, headers={"X-Export-Token": token})
        assert response.status_code == 200, response.text
        page = response.json()
        rows += page["rows"]
        pages += 1
        after = page["next"]
        if not after:
            return rows, pages


# ---------- Pure: impersonation pairing ----------

def at(day, hour, minute=0):
    return lagos(2026, 3, day, hour, minute)


def test_pairing_stop_new_start_portal_switch_and_flagged():
    events = [
        Event(1, at(2, 10), START, "boss", "boss@x", "HOD", "SCI"),
        Event(2, at(2, 11), START, "boss", "boss@x", "FACULTY_VIEWER", "ENG"),  # switches role
        Event(3, at(2, 11, 30), STOP, "boss", "boss@x"),
        # Crosses midnight, ended by a portal switch.
        Event(4, at(3, 23, 30), START, "boss", "boss@x", "DEO", "SCI"),
        Event(5, at(4, 0, 45), SWITCH, "boss", "boss@x"),
        # Never ended.
        Event(6, at(5, 9), START, "boss", "boss@x", "HOD", "SCI"),
        # Someone else's stop with no start (its start is before the events read) is ignored.
        Event(7, at(5, 10), STOP, "ada", "ada@x"),
    ]
    sessions = pair_sessions(list(reversed(events)))  # order doesn't matter
    assert [(s.acting_role, s.ended_by) for s in sessions] == [
        ("HOD", ENDED_BY_NEW_START),
        ("FACULTY_VIEWER", ENDED_BY_STOP),
        ("DEO", ENDED_BY_PORTAL_SWITCH),
        ("HOD", None),
    ]
    assert [s.duration_minutes for s in sessions] == [60.0, 30.0, 75.0, None]
    assert [s.flagged for s in sessions] == [False, False, False, True]

    attach_actions(sessions, [
        ("boss", at(2, 10, 30), "schedule_item.lecture.update"),
        ("boss", at(2, 11, 15), "course.update"),
        ("boss", at(2, 11, 15), "course.update"),
        ("boss", at(4, 0, 15), "schedule_item.exam.create"),  # after midnight, same session
        ("boss", at(4, 1), "course.delete"),  # between sessions: none
        ("ada", at(2, 10, 30), "course.update"),  # not impersonating anyone above
    ])
    assert [s.actions for s in sessions] == [
        {"schedule_item.lecture.update": 1},
        {"course.update": 2},
        {"schedule_item.exam.create": 1},
        {},
    ]
    # A session overlaps a range when any part of it falls inside.
    assert sessions[2].overlaps(at(4, 0), at(5, 0)) and not sessions[0].overlaps(at(3, 0), at(4, 0))
    assert sessions[3].overlaps(at(20, 0), at(21, 0))  # open sessions run on


# ---------- Pure: Members ----------

def test_members_flags_last_login_and_sort_order():
    now = datetime(2026, 11, 26, 12, tzinfo=timezone.utc)
    ago = lambda days: now - timedelta(days=days)  # noqa: E731
    accounts = [
        Account(1, "never@x", "DEO", "SCI", ago(50)),
        Account(2, "recent@x", "FACULTY_EDITOR", "SCI", ago(200)),
        Account(3, "switcher@x", "SUPER_VIEWER", None, ago(300)),
        Account(4, "idle@x", "FACULTY_VIEWER", "ENG", ago(300)),
        Account(5, "old@x", "HOD", "ENG", ago(400)),
        Account(6, "busy@x", "FACULTY_EDITOR", "SCI", ago(400)),
    ]
    facts = MemberFacts(
        accounts=accounts,
        invitations=[
            OpenInvitation(10, "pending@x", "FACULTY_VIEWER", "SCI", now + timedelta(days=5)),
            OpenInvitation(11, "expired@x", "HOD", "ENG", now - timedelta(days=3)),
        ],
        faculty_names={"SCI": "Faculty of Science", "ENG": "Faculty of Engineering"},
        invite_by_id={10: InviteEntry(ago(2), "boss@x")},
        invite_by_email={"recent@x": InviteEntry(ago(201), "boss@x")},
        invitation_expiry={"expired@x": now - timedelta(days=3), "never@x": ago(43)},
        sign_ins={
            "recent@x": Logins(ago(2), 3),
            "switcher@x": Logins(ago(20), 0),
            "idle@x": Logins(ago(40), 0),
            "old@x": Logins(ago(100), 0),
            "busy@x": Logins(ago(95), 0),
        },
        switches_in={"switcher@x": Logins(ago(5), 2)},
        activity={"recent@x": Activity(4, {"course": 3, "auth": 1}, [("course.create", 2), ("course.update", 1), ("auth.login", 1)])},
        # Recent activity keeps someone active even when their last login is old.
        last_activity={"busy@x": ago(1), "old@x": ago(100)},
        switch_portals={"switcher@x": {"ICE", "UG"}},
    )
    rows, overview = build_members(facts, realm_key="UG", now=now)
    by_email = {r["email"]: r for r in rows}

    # Sort: last login newest first, then never logged in, then invitations (newest invited first).
    assert [r["email"] for r in rows] == [
        "recent@x", "switcher@x", "idle@x", "busy@x", "old@x", "never@x", "pending@x", "expired@x",
    ]
    assert by_email["never@x"]["flags"] == [FLAG_NEVER]
    assert by_email["idle@x"]["flags"] == [FLAG_INACTIVE_30]
    assert by_email["old@x"]["flags"] == [FLAG_INACTIVE_90]  # replaces 30+
    assert by_email["busy@x"]["flags"] == []
    assert by_email["recent@x"]["flags"] == []

    # A switch into the portal counts as a login.
    switcher = by_email["switcher@x"]
    assert switcher["last_login_via"] == VIA_SWITCH and switcher["last_login_at"] == ago(5)
    assert (switcher["sign_ins_in_period"], switcher["switches_in_period"]) == (0, 2)
    assert switcher["portals_used"] == ["ICE", "UG"]
    recent = by_email["recent@x"]
    assert recent["last_login_via"] == VIA_SIGN_IN and recent["days_since_last_login"] == 2
    assert recent["faculty"] == "Faculty of Science" and recent["invited_by"] == "boss@x"
    assert recent["total_activities"] == 4 and [a["action"] for a in recent["top_actions"]] == ["course.create", "course.update", "auth.login"]

    # Invitations: the recorded inviter, else the date from the expiry and no inviter.
    pending, expired = by_email["pending@x"], by_email["expired@x"]
    assert pending["flags"] == [FLAG_PENDING] and pending["invited_by"] == "boss@x" and pending["invitation_age_days"] == 2
    assert expired["flags"] == [FLAG_EXPIRED] and expired["invited_by"] is None
    assert expired["invited_at"] == now - timedelta(days=10) and expired["invited_at_recorded"] is False
    # An account whose invite entry is missing gets the same fallback.
    assert by_email["never@x"]["invited_at"] == ago(50) and by_email["never@x"]["invited_at_recorded"] is False
    # No name or department fields: those columns are hidden.
    assert "name" not in recent and "department" not in recent and "status" not in recent

    assert overview["members"] == 6
    assert (overview["active_30_days"], overview["inactive"], overview["never_logged_in"]) == (3, 2, 1)
    assert (overview["pending_invitations"], overview["expired_invitations"]) == (1, 1)
    assert dict(overview["by_role"])["FACULTY_EDITOR"] == 2
    assert dict(overview["by_faculty"]) == {"Faculty of Science": 3, "Faculty of Engineering": 2, "No faculty": 1}


def test_filters_round_trip_through_the_token_form():
    original = parse_filters({
        "range": "custom", "from": "2026-03-01", "to": "2026-03-31", "time": "22:00-06:00",
        "type": "exam", "cat": ["schedule_item", "auth"], "action": "auth.login", "user": "Ada@X.com",
        "role": "HOD", "faculty": "SCI", "dept": "3", "q": "PHY", "portal": "this",
    })
    query = filters_to_query(original)
    assert query["time"] == "22:00-06:00" and query["user"] == ["ada@x.com"]
    assert parse_filters(query) == original
    assert filters_to_query(AuditFilters()) == {}


# ---------- Permissions ----------

async def test_only_a_super_admin_who_is_not_impersonating_can_export(signed_in, client):
    await add(Faculty(id="SCI", name="Faculty of Science", realm_key="UG"))
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    await add_logs({"action": "course.create", "created_at": lagos(2026, 3, 2)})
    assert (await admin.get(PREVIEW, params=MARCH)).status_code == 200
    token = (await start(admin))["token"]

    async def codes(c):
        return [
            (await c.get(PREVIEW, params=MARCH)).status_code,
            (await c.post(EXPORT, json={"filters": MARCH, "format": "pdf", "sections": ["summary"]})).status_code,
            (await c.get(ANALYSIS, headers={"X-Export-Token": token})).status_code,
            (await c.get(ROWS, headers={"X-Export-Token": token})).status_code,
        ]

    for role in (RoleEnum.SUPER_VIEWER, RoleEnum.FACULTY_EDITOR, RoleEnum.FACULTY_VIEWER, RoleEnum.HOD, RoleEnum.DEO, RoleEnum.GS_ADMIN, RoleEnum.CITS_ADMIN):
        other, _ = await signed_in(role, faculty_id="SCI" if role in (RoleEnum.FACULTY_EDITOR, RoleEnum.FACULTY_VIEWER, RoleEnum.HOD, RoleEnum.DEO) else None)
        assert await codes(other) == [403] * 4, role
        # The super viewer can still use the page.
        if role == RoleEnum.SUPER_VIEWER:
            assert (await other.get(f"{API}/audit/logs")).status_code == 200
    assert await codes(client) == [401] * 4

    # Impersonating anyone, even a super viewer, blocks exporting.
    for act_as in ({"role": "HOD", "faculty_id": "SCI"}, {"role": "SUPER_VIEWER"}):
        assert (await admin.post(f"{API}/auth/impersonate", json=act_as)).status_code == 200
        assert await codes(admin) == [403] * 4
    assert (await admin.post(f"{API}/auth/impersonate/stop", json={})).status_code == 200
    assert (await admin.get(PREVIEW, params=MARCH)).status_code == 200


async def test_the_token_belongs_to_one_admin_one_portal_and_is_not_a_login(signed_in, make_client):
    await add_logs({"action": "course.create", "created_at": lagos(2026, 3, 2)})
    first, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    second, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    token = (await start(first))["token"]
    assert (await second.get(ANALYSIS, headers={"X-Export-Token": token})).status_code == 401
    assert (await first.get(ANALYSIS)).status_code == 401
    assert (await first.get(ANALYSIS, headers={"X-Export-Token": "nonsense"})).status_code == 401

    # Switching portal: the token stays with the portal it was issued in.
    assert (await first.post(f"{API}/auth/switch-realm", json={"realm": "ICE"})).status_code == 200
    assert (await first.get(ANALYSIS, headers={"X-Export-Token": token})).status_code == 401

    # As a login cookie it is refused.
    thief = make_client()
    thief.cookies.set("access_token", token)
    assert (await thief.get(f"{API}/auth/me")).status_code == 401


# ---------- The analysis ----------

@pytest.fixture
async def march():
    """A month of UG activity, plus entries that must never be counted."""
    await add_logs(
        {"action": "course.create", "user_email": "ada@x.com", "user_role": "FACULTY_EDITOR", "created_at": lagos(2026, 3, 2, 9)},
        {"action": "course.update", "user_email": "ada@x.com", "user_role": "FACULTY_EDITOR", "created_at": lagos(2026, 3, 2, 10)},
        {"action": "schedule_item.exam.create", "user_email": "ada@x.com", "user_role": "FACULTY_EDITOR", "created_at": lagos(2026, 3, 3, 9, 30)},
        {"action": "auth.login", "user_email": "ada@x.com", "user_role": "FACULTY_EDITOR", "created_at": lagos(2026, 3, 3, 8)},
        {"action": "auth.switch_realm", "realm_key": None, "user_email": "boss@x.com", "user_role": "SUPER_ADMIN",
         "extra": {"from_realm": "UG", "to_realm": "ICE"}, "created_at": lagos(2026, 3, 4, 12)},
        {"action": "user.role_change", "user_email": "boss@x.com", "user_role": "SUPER_ADMIN", "created_at": lagos(2026, 3, 4, 13)},
        {"action": "course.delete", "user_email": "boss@x.com", "user_role": "SUPER_ADMIN", "created_at": lagos(2026, 3, 5, 14)},
        # Change requests: 7 was made before the range; 8 is decided in two hours; 9 is pending.
        {"action": "change_request.create", "entity_type": "change_request", "entity_id": "7", "user_email": "ada@x.com", "created_at": lagos(2026, 2, 20, 12)},
        {"action": "change_request.approve", "entity_type": "change_request", "entity_id": "7", "user_email": "boss@x.com", "user_role": "SUPER_ADMIN", "created_at": lagos(2026, 3, 6, 12)},
        {"action": "change_request.create", "entity_type": "change_request", "entity_id": "8", "user_email": "ada@x.com", "user_role": "FACULTY_EDITOR", "created_at": lagos(2026, 3, 10, 10)},
        {"action": "change_request.reject", "entity_type": "change_request", "entity_id": "8", "user_email": "boss@x.com", "user_role": "SUPER_ADMIN", "created_at": lagos(2026, 3, 10, 12)},
        {"action": "change_request.create", "entity_type": "change_request", "entity_id": "9", "user_email": "ada@x.com", "user_role": "FACULTY_EDITOR", "created_at": lagos(2026, 3, 11, 9)},
        # Never counted: another portal, and outside the range.
        {"action": "course.create", "realm_key": "ICE", "user_email": "ice@x.com", "created_at": lagos(2026, 3, 2, 9)},
        {"action": "course.create", "user_email": "ada@x.com", "created_at": lagos(2026, 4, 2, 9)},
    )


async def test_every_section_aggregates_in_lagos_time(admin, march):
    preview = (await admin.get(PREVIEW, params=MARCH)).json()
    assert preview["events"] == 11 and preview["first"] == "2026-03-01" and preview["last"] == "2026-03-31"

    started = await start(admin)
    assert started["events"] == 11 and started["file_name"] == "unischedule-activity-analysis_2026-03-01_2026-03-31.xlsx"
    assert started["timezone"] == "Africa/Lagos" and started["generated_at"].endswith("+01:00")
    result = await analysis(admin, started["token"])

    summary = result["summary"]
    assert (summary["total_events"], summary["unique_users"]) == (11, 2)
    assert summary["busiest_day"] == {"date": "2026-03-02", "count": 2}  # ties: the earliest day
    assert summary["busiest_hour"] == {"hour": 9, "count": 3}  # ties: the earliest hour
    assert summary["most_common_action"] == {"action": "change_request.create", "count": 2}
    assert summary["cross_portal_events"] == 1 and summary["days"] == 31

    cats = {c["key"]: c for c in result["categories"]["categories"]}
    assert cats["course"]["count"] == 3 and cats["course"]["pct"] == 27.3
    assert cats["change_request"]["count"] == 4 and cats["schedule_item.exam"]["count"] == 1
    assert sum(c["count"] for c in cats.values()) == 11  # nothing counted twice

    users = {u["email"]: u for u in result["users"]["users"]}
    assert users["ada@x.com"]["count"] == 6 and users["boss@x.com"]["count"] == 5
    assert users["ada@x.com"]["top_actions"][0] == {"action": "change_request.create", "count": 2}
    assert users["boss@x.com"]["deleted"] is True  # no account has this address
    assert "ice@x.com" not in users

    roles = result["roles_portals"]
    assert {r["role"]: r["count"] for r in roles["roles"]} == {"SUPER_ADMIN": 5, "FACULTY_EDITOR": 6}
    assert {p["scope"]: p["count"] for p in roles["portals"]} == {"this": 10, "cross": 1}
    assert roles["switches"] == [{"email": "boss@x.com", "count": 1, "to": {"ICE": 1}}]

    over = result["over_time"]
    assert over["granularity"] == "day" and len(over["buckets"]) == 31
    assert over["buckets"][1] == {"start": "2026-03-02", "total": 2, "by_category": {"course": 2}}
    # 2 March 2026 is a Monday: row 0.
    assert over["heatmap"][0][9] == 1 and over["heatmap"][0][10] == 1
    assert sum(map(sum, over["heatmap"])) == 11

    sensitive = result["sensitive"]
    assert sensitive["total"] == 2 and {a["action"] for a in sensitive["by_action"]} == {"user.role_change", "course.delete"}
    # The export's own log entry was written after the export's last id, so it isn't included.
    assert all(e["action"] != "activity_log.export" for e in sensitive["entries"])

    cr = result["change_requests"]
    assert (cr["created"], cr["approved"], cr["rejected"], cr["still_pending"]) == (2, 1, 1, 1)
    # Request 7 took 14 days (336 h), request 8 two hours.
    assert cr["decisions_timed"] == 2 and cr["median_hours"] == 169.0
    assert {o["outcome"]: o["median_hours"] for o in cr["by_outcome"]} == {"Approved": 336.0, "Rejected": 2.0}


async def test_weekly_buckets_beyond_62_days(admin, march):
    started = await start(admin, {"range": "custom", "from": "2026-01-01", "to": "2026-03-31"}, sections=["over_time"])
    over = (await analysis(admin, started["token"]))["over_time"]
    assert over["granularity"] == "week"
    assert over["buckets"][0]["start"] == "2025-12-29"  # the Monday on or before 1 January
    assert sum(b["total"] for b in over["buckets"]) == 12  # change request 7's create is in range now


async def test_raw_rows_page_oldest_first_and_stay_fixed(admin, march):
    started = await start(admin)
    rows, pages = await all_rows(admin, started["token"], limit=4)
    assert pages == 3 and len(rows) == 11
    assert [r["created_at"] for r in rows] == sorted(r["created_at"] for r in rows)
    assert rows[0]["created_at"] == "2026-03-02T09:00:00+01:00"
    switch = next(r for r in rows if r["action"] == "auth.switch_realm")
    assert switch["portal"] == "Cross-portal" and switch["category"] == "auth" and switch["extra"]["to_realm"] == "ICE"

    # Entries written after the export never join it.
    await add_logs({"action": "course.create", "user_email": "late@x.com", "created_at": lagos(2026, 3, 15)})
    rows_again, _ = await all_rows(admin, started["token"])
    assert len(rows_again) == 11
    assert (await analysis(admin, started["token"]))["summary"]["total_events"] == 11


async def test_impersonated_rows_show_the_real_user_and_the_role_acted_as(admin):
    await add_logs(
        {"action": "auth.impersonate.start", "user_email": "boss@x.com", "user_role": "SUPER_ADMIN",
         "extra": {"act_as_role": "HOD", "act_as_faculty_id": "SCI"}, "created_at": lagos(2026, 3, 2, 10)},
        {"action": "schedule_item.lecture.update", "user_email": "boss@x.com", "user_role": "HOD", "user_faculty_id": "SCI",
         "extra": {"impersonation": {"real_role": "SUPER_ADMIN", "acting_as_role": "HOD", "acting_as_faculty_id": "SCI"}},
         "created_at": lagos(2026, 3, 2, 10, 30)},
        # Switching role while impersonating logs a new start, itself stamped as impersonated.
        # It ends the HOD session and isn't counted as an action in either session.
        {"action": "auth.impersonate.start", "user_email": "boss@x.com", "user_role": "HOD",
         "extra": {"act_as_role": "FACULTY_VIEWER", "act_as_faculty_id": "SCI",
                   "impersonation": {"real_role": "SUPER_ADMIN", "acting_as_role": "HOD"}}, "created_at": lagos(2026, 3, 2, 10, 45)},
        {"action": "auth.impersonate.stop", "user_email": "boss@x.com", "user_role": "FACULTY_VIEWER",
         "extra": {"impersonation": {"real_role": "SUPER_ADMIN", "acting_as_role": "FACULTY_VIEWER"}}, "created_at": lagos(2026, 3, 2, 11)},
        # Starts on the last evening of the range and is never stopped.
        {"action": "auth.impersonate.start", "user_email": "boss@x.com", "user_role": "SUPER_ADMIN",
         "extra": {"act_as_role": "DEO", "act_as_faculty_id": "SCI"}, "created_at": lagos(2026, 3, 31, 23)},
        # Another portal's session never shows.
        {"action": "auth.impersonate.start", "realm_key": "ICE", "user_email": "boss@x.com",
         "extra": {"act_as_role": "HOD"}, "created_at": lagos(2026, 3, 3, 10)},
    )
    started = await start(admin)
    result = await analysis(admin, started["token"])
    sessions = result["impersonation"]["sessions"]
    assert [(s["acting_role"], s["ended_by"], s["duration_minutes"], s["action_count"]) for s in sessions] == [
        ("HOD", "Switched role", 45.0, 1),
        ("FACULTY_VIEWER", "Stopped", 15.0, 0),
        ("DEO", None, None, 0),
    ]
    assert sessions[2]["flagged"] is True and sessions[2]["flag"] == "No stop recorded"
    assert result["impersonation"]["flagged"] == 1

    row = next(r for r in (await all_rows(admin, started["token"]))[0] if r["action"] == "schedule_item.lecture.update")
    assert (row["user_email"], row["user_role"], row["real_role"], row["impersonating"]) == ("boss@x.com", "HOD", "SUPER_ADMIN", True)

    # The roles filter decides whose sessions show (here: who was acted as). A DEO-only
    # report leaves impersonation out (a DEO can't impersonate); adding Super Admin
    # brings it back with just the sessions acted as a DEO.
    only_deo = await start(admin, {**MARCH, "role": "DEO"}, sections=["impersonation", "members"])
    assert "impersonation" not in (await analysis(admin, only_deo["token"]))
    deo_and_admins = await start(admin, {**MARCH, "role": ["DEO", "SUPER_ADMIN"]}, sections=["impersonation", "members"])
    assert [s["acting_role"] for s in (await analysis(admin, deo_and_admins["token"]))["impersonation"]["sessions"]] == ["DEO"]


async def test_reports_on_people_who_cant_impersonate_leave_impersonated_entries_out(admin):
    acting = {"impersonation": {"real_role": "SUPER_ADMIN", "acting_as_role": "FACULTY_EDITOR"}}
    await add_logs(
        {"action": "course.update", "user_email": "editor@x.com", "user_role": "FACULTY_EDITOR", "created_at": lagos(2026, 3, 2, 9)},
        {"action": "course.create", "user_email": "editor@x.com", "user_role": "FACULTY_EDITOR", "extra": None, "created_at": lagos(2026, 3, 2, 9, 5)},
        {"action": "auth.impersonate.start", "user_email": "boss@x.com", "user_role": "SUPER_ADMIN",
         "extra": {"act_as_role": "FACULTY_EDITOR"}, "created_at": lagos(2026, 3, 2, 10)},
        {"action": "course.delete", "user_email": "boss@x.com", "user_role": "FACULTY_EDITOR", "extra": acting,
         "created_at": lagos(2026, 3, 2, 10, 30)},
        {"action": "auth.impersonate.stop", "user_email": "boss@x.com", "user_role": "FACULTY_EDITOR", "extra": acting,
         "created_at": lagos(2026, 3, 2, 11)},
    )
    editors = {**MARCH, "role": "FACULTY_EDITOR"}
    preview = (await admin.get(PREVIEW, params=editors)).json()
    assert (preview["events"], preview["impersonation_applies"]) == (2, False)
    started = await start(admin, editors)
    assert started["events"] == 2
    result = await analysis(admin, started["token"])
    assert result["summary"]["total_events"] == 2
    assert sorted(r["action"] for r in (await all_rows(admin, started["token"]))[0]) == ["course.create", "course.update"]

    # With Super Admin in the report, the acted-as entries are back.
    with_admins = await start(admin, {**MARCH, "role": ["FACULTY_EDITOR", "SUPER_ADMIN"]})
    assert "course.delete" in [r["action"] for r in (await all_rows(admin, with_admins["token"]))[0]]


async def test_locked_timetables_lists_each_reopening_and_the_edits_made_while_open(admin):
    (session,) = await add(AcademicSession(name="2025/2026", realm_key="UG"))
    (semester,) = await add(Semester(name="Second Semester", session_id=session.id))
    exam, lecture = f"{semester.id}:exam", f"{semester.id}:lecture"
    sid = semester.id
    await add_logs(
        {"action": "timetable.lock", "entity_type": "timetable_lock", "entity_id": exam, "user_email": "boss@x.com", "created_at": lagos(2026, 3, 1, 9)},
        {"action": "timetable.edit_request", "entity_type": "timetable_lock", "entity_id": exam, "user_email": "editor@x.com",
         "extra": {"reason": "Clash in LT1"}, "created_at": lagos(2026, 3, 3, 9)},
        {"action": "timetable.unlock", "entity_type": "timetable_lock", "entity_id": exam, "user_email": "boss@x.com", "created_at": lagos(2026, 3, 3, 10)},
        {"action": "schedule_item.exam.update", "entity_type": "schedule_item", "entity_id": "77", "user_email": "editor@x.com",
         "extra": {"semester_id": sid, "before": {"day_of_week": "Monday"}}, "created_at": lagos(2026, 3, 3, 11)},
        {"action": "timetable.exam.shift", "entity_type": "semester", "entity_id": str(sid), "user_email": "boss@x.com", "created_at": lagos(2026, 3, 3, 12)},
        # Another semester's edit, and a lecture edit, aren't this reopening's.
        {"action": "schedule_item.exam.update", "entity_type": "schedule_item", "entity_id": "78", "extra": {"semester_id": sid + 1000}, "created_at": lagos(2026, 3, 3, 11)},
        {"action": "schedule_item.lecture.update", "entity_type": "schedule_item", "entity_id": "79", "extra": {"semester_id": sid}, "created_at": lagos(2026, 3, 3, 11)},
        {"action": "timetable.lock", "entity_type": "timetable_lock", "entity_id": exam, "user_email": "boss@x.com", "created_at": lagos(2026, 3, 3, 14)},
        # Reopened without a request and never locked again.
        {"action": "timetable.lock", "entity_type": "timetable_lock", "entity_id": lecture, "user_email": "boss@x.com", "created_at": lagos(2026, 3, 10, 9)},
        {"action": "timetable.unlock", "entity_type": "timetable_lock", "entity_id": lecture, "user_email": "boss@x.com", "created_at": lagos(2026, 3, 20, 9)},
        # Another portal's reopening never shows.
        {"action": "timetable.unlock", "realm_key": "ICE", "entity_type": "timetable_lock", "entity_id": "5:exam", "created_at": lagos(2026, 3, 5)},
    )
    locks = (await analysis(admin, (await start(admin, sections=["locks"]))["token"]))["locks"]
    assert (locks["total"], locks["still_open"], locks["without_request"]) == (2, 1, 1)
    first, second = locks["reopenings"]
    assert (first["timetable_type"], first["session_name"], first["semester_name"]) == ("exam", "2025/2026", "Second Semester")
    assert (first["unlocked_by"], first["relocked_by"], first["open_hours"]) == ("boss@x.com", "boss@x.com", 4.0)
    assert [r["reason"] for r in first["requests"]] == ["Clash in LT1"]
    assert first["edit_count"] == 2
    assert [e["action"] for e in first["edits"]] == ["schedule_item.exam.update", "timetable.exam.shift"]
    assert first["editors"] == [{"email": "boss@x.com", "count": 1}, {"email": "editor@x.com", "count": 1}]
    assert (second["timetable_type"], second["relocked_at"], second["open_hours"], second["edit_count"]) == ("lecture", None, None, 0)

    # The edits counted follow the filters; the reopenings don't.
    only_editor = await start(admin, {**MARCH, "user": "editor@x.com"}, sections=["locks"])
    first = (await analysis(admin, only_editor["token"]))["locks"]["reopenings"][0]
    assert (first["unlocked_by"], first["edit_count"]) == ("boss@x.com", 1)
    # An exam export only lists exam reopenings.
    exams = await start(admin, {**MARCH, "type": "exam"}, sections=["locks"])
    assert [r["timetable_type"] for r in (await analysis(admin, exams["token"]))["locks"]["reopenings"]] == ["exam"]


async def test_summary_and_categories_compare_with_the_period_before(admin):
    await add_logs(
        {"action": "course.create", "user_email": "a@x.com", "created_at": lagos(2026, 3, 2)},
        {"action": "course.update", "user_email": "a@x.com", "created_at": lagos(2026, 3, 3)},
        # February (28 days) and the last 3 days of January: the 31 days before March.
        {"action": "course.create", "user_email": "b@x.com", "created_at": lagos(2026, 2, 10)},
        {"action": "room.create", "user_email": "b@x.com", "created_at": lagos(2026, 1, 29)},
        {"action": "room.create", "created_at": lagos(2026, 1, 28)},
    )
    result = await analysis(admin, (await start(admin, sections=["summary", "categories"]))["token"])
    previous = result["summary"]["previous"]
    assert (previous["first"], previous["last"], previous["total_events"], previous["unique_users"]) == ("2026-01-29", "2026-02-28", 2, 1)
    by_key = {c["key"]: c for c in result["categories"]["categories"]}
    assert (by_key["course"]["count"], by_key["course"]["previous"]) == (2, 1)
    assert (by_key["room"]["count"], by_key["room"]["previous"]) == (0, 1)


async def test_out_of_hours_uses_the_portals_calendar_and_holidays(admin):
    (session,) = await add(AcademicSession(name="2025/2026", realm_key="UG"))
    (semester,) = await add(Semester(name="Second Semester", session_id=session.id))
    await add(BlockedSlot(name="Eid holiday", date=date(2026, 3, 20), applies_to="EXAM_ONLY", semester_id=semester.id))
    await add_logs(
        {"action": "course.create", "user_email": "a@x.com", "created_at": lagos(2026, 3, 2, 10)},   # Monday, in hours
        {"action": "course.update", "user_email": "a@x.com", "created_at": lagos(2026, 3, 2, 22)},   # Monday night
        {"action": "course.delete", "user_email": "b@x.com", "created_at": lagos(2026, 3, 8, 11)},   # Sunday
        {"action": "course.update", "user_email": "b@x.com", "created_at": lagos(2026, 3, 20, 11)},  # the holiday (a Friday)
    )
    o = (await analysis(admin, (await start(admin, sections=["out_of_hours"]))["token"]))["out_of_hours"]
    assert o["working_hours"]["days"] == ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    assert (o["working_hours"]["start"], o["working_hours"]["end"]) == ("08:00", "18:00")
    assert o["working_hours"]["holidays"] == [{"date": "2026-03-20", "name": "Eid holiday"}]
    assert (o["total"], o["pct"]) == (3, 75.0)
    assert {r["reason"]: r["count"] for r in o["by_reason"]} == {"Outside working hours": 1, "Non-working day": 1, "Holiday": 1}
    assert [e["reason"] for e in o["entries"]] == ["Holiday (Eid holiday)", "Non-working day", "Outside working hours"]


async def test_unusual_activity_finds_mass_deletions_bursts_and_other_faculties(admin):
    base = lagos(2026, 3, 4, 9)
    await add_logs(
        *[{"action": "course.delete", "user_email": "a@x.com", "created_at": base + timedelta(minutes=3 * i)} for i in range(12)],
        # Nine deletions in an hour isn't enough.
        *[{"action": "room.delete", "user_email": "b@x.com", "created_at": base + timedelta(minutes=5 * i)} for i in range(9)],
        *[{"action": "course.update", "user_email": "c@x.com", "created_at": lagos(2026, 3, 5, 9) + timedelta(seconds=5 * i)} for i in range(61)],
        {"action": "schedule_item.lecture.update", "entity_type": "schedule_item", "entity_id": "1", "user_email": "d@x.com",
         "user_faculty_id": "ENG", "extra": {"faculty_id": "SCI"}, "created_at": lagos(2026, 3, 6)},
        {"action": "schedule_item.lecture.update", "entity_type": "schedule_item", "entity_id": "2", "user_email": "d@x.com",
         "user_faculty_id": "ENG", "extra": {"faculty_id": "ENG"}, "created_at": lagos(2026, 3, 6)},
    )
    u = (await analysis(admin, (await start(admin, sections=["unusual"]))["token"]))["unusual"]
    assert [(d["email"], d["count"]) for d in u["mass_deletions"]] == [("a@x.com", 12)]
    assert u["mass_deletions"][0]["from"] == "2026-03-04T09:00:00+01:00"
    assert [(b["email"], b["count"]) for b in u["bursts"]] == [("c@x.com", 61)]
    assert [(r["user_email"], r["item_faculty_id"]) for r in u["other_faculty"]] == [("d@x.com", "SCI")]


async def test_handovers_course_history_and_exports(admin):
    (faculty,) = await add(Faculty(id="SCI", name="Faculty of Science", realm_key="UG"))
    await add(
        EditorHandover(realm_key="UG", faculty_id="SCI", granted_by_email="ed@x.com", holder_email="vi@x.com",
                       started_at=lagos(2026, 3, 2), ended_at=lagos(2026, 3, 12), end_reason="returned"),
        EditorHandover(realm_key="UG", faculty_id="SCI", granted_by_email="ed2@x.com", holder_email="vi2@x.com", started_at=lagos(2026, 3, 20)),
        # Ended before March.
        EditorHandover(realm_key="UG", faculty_id="SCI", granted_by_email="old@x.com", holder_email="o@x.com",
                       started_at=lagos(2026, 1, 2), ended_at=lagos(2026, 1, 5), end_reason="returned"),
    )
    await add_logs(
        {"action": "schedule_item.exam.create", "entity_type": "schedule_item", "entity_id": "1", "extra": {"course_code": "PHY101"}, "created_at": lagos(2026, 3, 2)},
        {"action": "schedule_item.exam.update", "entity_type": "schedule_item", "entity_id": "1", "extra": {"course_code": "PHY101"}, "created_at": lagos(2026, 3, 3)},
        # An older entry with no code recorded: read from its description.
        {"action": "schedule_item.exam.delete", "entity_type": "schedule_item", "entity_id": "2", "description": "Removed exam for CHM101 from Monday", "created_at": lagos(2026, 3, 4)},
        {"action": "activity_log.export", "user_email": "boss@x.com", "extra": {"format": "pdf", "from": "2026-02-01", "to": "2026-02-28", "mask_emails": False, "row_count": 9}, "created_at": lagos(2026, 3, 5)},
    )
    result = await analysis(admin, (await start(admin, sections=["handovers", "courses", "exports"]))["token"])
    h = result["handovers"]
    assert (h["total"], h["active"], h["started_in_period"]) == (2, 1, 2)
    assert (h["handovers"][0]["faculty_name"], h["handovers"][0]["days_held"], h["handovers"][0]["end_reason"]) == ("Faculty of Science", 10.0, "returned")
    c = result["courses"]
    assert [(x["code"], x["changes"]) for x in c["courses"]] == [("PHY101", 2), ("CHM101", 1)]
    assert [e["action"] for e in c["courses"][0]["entries"]] == ["schedule_item.exam.create", "schedule_item.exam.update"]
    e = result["exports"]
    assert (e["total"], e["unmasked"], e["exports"][0]["row_count"]) == (1, 1, 9)

    # Exports, like impersonation, only appear in reports that can cover a super admin.
    editors = await start(admin, {**MARCH, "role": "FACULTY_EDITOR"}, sections=["exports", "courses", "members"])
    assert editors["sections"] == ["courses", "members", "raw"]


async def test_a_reports_verification_code_confirms_it_without_saying_whom_it_covers(admin, client):
    await add_logs({"action": "course.create", "user_email": "editor@x.com", "created_at": lagos(2026, 3, 2)})
    started = await start(admin, {**MARCH, "user": "editor@x.com"}, fmt="pdf", sections=["summary"])
    code = started["verification_code"]
    assert code.startswith("LOG-") and len(code) == 13

    # Public: no sign-in needed, any case and spacing.
    response = await client.get(f"{API}/verify/{code.lower()}")
    assert response.status_code == 200, response.text
    found = response.json()
    assert found["document"] == "activity_report"
    assert found["reference"] == f"AL-UG-{started['reference']:06d}"
    assert (found["first"], found["last"], found["events"], found["format"]) == ("2026-03-01", "2026-03-31", 1, "pdf")
    assert "editor@x.com" not in response.text and "filters" not in found

    missing = await client.get(f"{API}/verify/LOG-AAAA-BBBB")
    assert missing.status_code == 404


async def test_exam_exports_hold_no_lecture_rows(admin):
    await add_logs(
        {"action": "schedule_item.lecture.create", "created_at": lagos(2026, 3, 2)},
        {"action": "schedule_item.exam.create", "created_at": lagos(2026, 3, 2)},
        {"action": "blocked_slot.create", "entity_type": "blocked_slot", "entity_id": "1", "extra": {"applies_to": "BOTH"}, "created_at": lagos(2026, 3, 2)},
        {"action": "course.create", "created_at": lagos(2026, 3, 2)},
    )
    exam = await start(admin, {**MARCH, "type": "exam"})
    rows, _ = await all_rows(admin, exam["token"])
    assert sorted(r["action"] for r in rows) == ["blocked_slot.create", "schedule_item.exam.create"]
    assert {r["timetable_type"] for r in rows} == {"exam", "both"}
    lecture = await start(admin, {**MARCH, "type": "lecture"})
    assert sorted(r["action"] for r in (await all_rows(admin, lecture["token"]))[0]) == ["blocked_slot.create", "schedule_item.lecture.create"]


# ---------- Rules ----------

async def test_twelve_month_limit(admin, march):
    for filters in ({"range": "all"}, {"range": "custom", "from": "2025-03-01", "to": "2026-03-01"}):
        for response in (
            await admin.get(PREVIEW, params=filters),
            await admin.post(EXPORT, json={"filters": filters, "format": "xlsx", "sections": ["summary"]}),
        ):
            assert response.status_code == 422 and "12 months" in response.json()["detail"]
    # Exactly 12 months is fine.
    assert (await admin.get(PREVIEW, params={"range": "custom", "from": "2025-03-02", "to": "2026-03-01"})).status_code == 200

    # The current-session preset is shortened instead, and says so.
    (session,) = await add(AcademicSession(name="2024/2025", realm_key="UG", is_current=True))
    today = lagos_today()
    await add_logs({"action": "calendar.session.current", "entity_type": "academic_session", "entity_id": str(session.id),
                    "created_at": datetime.now(timezone.utc) - timedelta(days=800)})
    preview = (await admin.get(PREVIEW, params={"range": "session"})).json()
    assert preview["clamped"] is True
    assert preview["first"] == earliest_export_start(today).isoformat() and preview["last"] == today.isoformat()


async def test_no_matching_events_means_no_file_unless_members_are_ticked(admin, march):
    nothing = {**MARCH, "q": "matches-nothing"}
    response = await admin.post(EXPORT, json={"filters": nothing, "format": "xlsx", "sections": ["summary", "raw"]})
    assert response.status_code == 422 and "Members" in response.json()["detail"]
    started = await start(admin, nothing, sections=["members", "summary"])
    assert started["events"] == 0 and started["members"] == 1  # the admin's own account
    result = await analysis(admin, started["token"])
    assert result["summary"]["total_events"] == 0 and result["members"]["rows"][0]["kind"] == "member"


async def test_each_export_is_logged_and_rate_limited(admin, march):
    await start(admin, {**MARCH, "type": "exam", "cat": "schedule_item"}, fmt="pdf", sections=["summary"], mask=True)
    logged = (await admin.get(f"{API}/audit/logs", params={"cat": "activity_log"})).json()
    assert len(logged) == 1
    extra = logged[0]["extra"]
    assert extra["format"] == "pdf" and extra["sections"] == ["summary"] and extra["mask_emails"] is True
    assert extra["row_count"] == 1 and extra["filters"] == {**MARCH, "type": "exam", "cat": ["schedule_item"]}
    assert (extra["from"], extra["to"]) == ("2026-03-01", "2026-03-31")

    for _ in range(9):
        await start(admin, sections=["summary"])
    response = await admin.post(EXPORT, json={"filters": MARCH, "format": "pdf", "sections": ["summary"]})
    assert response.status_code == 429 and "15 minutes" in response.json()["detail"]
    # Refused requests aren't logged, so they don't count.
    assert len((await admin.get(f"{API}/audit/logs", params={"cat": "activity_log"})).json()) == 10


async def test_formats_and_raw_data(admin, march):
    xlsx = await start(admin, sections=["summary"])
    assert xlsx["sections"] == ["summary", "raw"]  # an XLSX always has Raw data
    pdf = await start(admin, fmt="pdf", sections=["summary"])
    assert pdf["file_name"].endswith(".pdf") and pdf["sections"] == ["summary"]
    assert (await admin.get(ROWS, headers={"X-Export-Token": pdf["token"]})).status_code == 403
    with_appendix = await start(admin, fmt="pdf", sections=["summary", "raw"])
    assert len((await all_rows(admin, with_appendix["token"]))[0]) == 11
    assert (await admin.post(EXPORT, json={"filters": MARCH, "format": "csv", "sections": ["summary"]})).status_code == 422
    assert (await admin.post(EXPORT, json={"filters": MARCH, "format": "xlsx", "sections": []})).status_code == 422


# ---------- Members through the API ----------

async def test_members_section(signed_in, make_user):
    await add(Faculty(id="SCI", name="Faculty of Science", realm_key="UG"), Faculty(id="ICE-SCI", name="ICE Science", realm_key="ICE"))
    admin, me = await signed_in(RoleEnum.SUPER_ADMIN)
    now = datetime.now(timezone.utc)
    ago = lambda days: now - timedelta(days=days)  # noqa: E731
    recent = await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="SCI", email="recent@x.com")
    viewer = await make_user(RoleEnum.SUPER_VIEWER, email="viewer@x.com")  # cross-realm
    await make_user(RoleEnum.FACULTY_VIEWER, faculty_id="SCI", email="idle@x.com")
    await make_user(RoleEnum.DEO, faculty_id="SCI", email="never@x.com")
    await make_user(RoleEnum.FACULTY_EDITOR, faculty_id="ICE-SCI", email="ice@x.com", realm="ICE")
    await add(
        Invitation(email="pending@x.com", token="t1", target_role=RoleEnum.HOD, faculty_id="SCI", expires_at=now + timedelta(days=5), is_used=False, realm_key="UG"),
        Invitation(email="expired@x.com", token="t2", target_role=RoleEnum.HOD, faculty_id="SCI", expires_at=ago(3), is_used=False, realm_key="UG"),
        Invitation(email="ice-invite@x.com", token="t3", target_role=RoleEnum.HOD, faculty_id="ICE-SCI", expires_at=now + timedelta(days=5), is_used=False, realm_key="ICE"),
    )
    await add_logs(
        {"action": "auth.login", "user_id": recent["id"], "user_email": "recent@x.com", "created_at": ago(2)},
        {"action": "course.create", "user_email": "recent@x.com", "created_at": ago(2)},
        {"action": "auth.switch_realm", "realm_key": None, "user_email": "viewer@x.com", "extra": {"from_realm": "ICE", "to_realm": "UG"}, "created_at": ago(5)},
        {"action": "auth.login", "user_email": "idle@x.com", "created_at": ago(40)},
        {"action": "user.invite", "entity_type": "invitation", "entity_id": "1", "user_email": me["email"], "extra": {"email": "pending@x.com"}, "created_at": ago(2)},
        # A sign-in to another portal isn't a login here.
        {"action": "auth.login", "realm_key": "ICE", "user_email": "never@x.com", "created_at": ago(1)},
    )
    seven_days = {"range": "last_7_days"}
    preview = (await admin.get(PREVIEW, params=seven_days)).json()
    assert (preview["members"], preview["invitations"]) == (5, 2)

    started = await start(admin, seven_days, sections=["members"])
    members = (await analysis(admin, started["token"]))["members"]
    rows = members["rows"]
    assert [r["email"] for r in rows] == [
        me["email"], "recent@x.com", "viewer@x.com", "idle@x.com", "never@x.com", "pending@x.com", "expired@x.com",
    ]
    by_email = {r["email"]: r for r in rows}
    assert by_email["viewer@x.com"]["last_login_via"] == "Portal switch" and by_email["viewer@x.com"]["portals_used"] == ["ICE", "UG"]
    assert by_email["recent@x.com"]["sign_ins_in_period"] == 1 and by_email["recent@x.com"]["total_activities"] == 2
    assert by_email["recent@x.com"]["faculty"] == "Faculty of Science"
    assert by_email["idle@x.com"]["flags"] == ["Inactive 30+ days"]
    assert by_email["never@x.com"]["flags"] == ["Never logged in"]
    assert by_email["pending@x.com"]["flags"] == ["Pending invitation"] and by_email["pending@x.com"]["invited_by"] == me["email"]
    assert by_email["expired@x.com"]["flags"] == ["Expired invitation"] and by_email["expired@x.com"]["invited_by"] is None
    overview = members["overview"]
    assert (overview["pending_invitations"], overview["expired_invitations"], overview["never_logged_in"]) == (1, 1, 1)
    assert any("logouts aren't" in note for note in members["notes"])
    assert any("Names and departments" in note for note in members["notes"])

    # The users, roles and faculty filters decide who is listed.
    narrowed = (await admin.get(PREVIEW, params={**seven_days, "role": "DEO"})).json()
    assert (narrowed["members"], narrowed["invitations"]) == (1, 0)
    by_user = (await admin.get(PREVIEW, params={**seven_days, "user": viewer["email"]})).json()
    assert (by_user["members"], by_user["invitations"]) == (1, 0)


# ---------- Small helpers ----------

def test_lagos_month_fixture_dates_are_inside_the_limit():
    assert earliest_export_start(date(2026, 3, 31)) <= date(2026, 3, 1)
    assert custom("2026-03-01", "2026-03-31") == MARCH


async def test_detail_keys_for_the_raw_data_columns(admin):
    await add_logs(
        {"action": "course.update", "extra": {"course_id": 4, "after": {"title": "Physics I", "units": {"min": 2}}}, "created_at": lagos(2026, 3, 2)},
        {"action": "user.role_change", "extra": {"from_role": "HOD", "before": {}, "ids": [1, 2]}, "created_at": lagos(2026, 3, 3)},
        # An older row whose details aren't an object, and one with none.
        {"action": "course.create", "extra": "legacy text", "created_at": lagos(2026, 3, 4)},
        {"action": "course.delete", "created_at": lagos(2026, 3, 5)},
        # Outside the export: never a column.
        {"action": "course.create", "extra": {"elsewhere": 1}, "realm_key": "ICE", "created_at": lagos(2026, 3, 2)},
    )
    started = await start(admin, sections=["summary"])
    result = await analysis(admin, started["token"])
    assert result["detail_keys"] == ["after.title", "after.units", "before", "course_id", "from_role", "ids"]
    pdf = await start(admin, fmt="pdf", sections=["summary"])
    assert "detail_keys" not in await analysis(admin, pdf["token"])


async def test_impersonation_section_only_for_people_who_can_impersonate(signed_in, make_user):
    # Only super admins can impersonate. A report about people who can't leaves
    # the section out entirely, rather than showing an empty one.
    admin, me = await signed_in(RoleEnum.SUPER_ADMIN)
    await make_user(RoleEnum.FACULTY_EDITOR, email="editor@x.com")
    await make_user(RoleEnum.SUPER_ADMIN, email="quiet-admin@x.com")
    await make_user(RoleEnum.FACULTY_VIEWER, email="former-admin@x.com")
    now = datetime.now(timezone.utc)
    await add_logs(
        {"action": "course.create", "user_email": "editor@x.com", "user_role": "FACULTY_EDITOR", "created_at": now - timedelta(days=1)},
        {"action": "auth.login", "user_email": "quiet-admin@x.com", "user_role": "SUPER_ADMIN", "created_at": now - timedelta(days=1)},
        # Was a super admin once and impersonated; now a viewer.
        {"action": "auth.impersonate.start", "user_email": "former-admin@x.com", "extra": {"act_as_role": "FACULTY_EDITOR"}, "created_at": now - timedelta(days=200)},
        {"action": "auth.login", "user_email": "former-admin@x.com", "created_at": now - timedelta(days=1)},
    )
    week = {"range": "last_7_days"}

    async def check(filters, applies):
        preview = (await admin.get(PREVIEW, params=filters_to_query(parse_filters(filters)))).json()
        assert preview["impersonation_applies"] is applies, (filters, preview)
        started = await start(admin, filters, fmt="pdf", sections=["summary", "impersonation"])
        assert ("impersonation" in started["sections"]) is applies, filters
        assert started["impersonation_applies"] is applies
        result = await analysis(admin, started["token"])
        assert ("impersonation" in result) is applies, filters

    # Someone who can't impersonate: left out.
    await check({**week, "user": ["editor@x.com"]}, False)
    # A role that can't impersonate: left out.
    await check({**week, "role": ["FACULTY_EDITOR"]}, False)
    # A super admin with no sessions: shown, "0 sessions" is itself a finding.
    await check({**week, "user": ["quiet-admin@x.com"]}, True)
    # A former super admin who impersonated: shown.
    await check({**week, "user": ["former-admin@x.com"]}, True)
    # One of several can: shown.
    await check({**week, "user": ["editor@x.com", "quiet-admin@x.com"]}, True)
    # The Super Admin role, or the whole portal: shown.
    await check({**week, "role": ["SUPER_ADMIN"]}, True)
    await check(week, True)
