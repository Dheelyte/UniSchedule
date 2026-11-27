"""The Members section of the Activity Logs export: every account with access to
the portal, including those with no activity, plus invitations not yet accepted.

build_members() is pure: the queries that feed it are in analysis.py.

- Last login is the later of the latest `auth.login` in this portal and the
  latest switch into it (`auth.switch_realm` with to_realm = this portal), with
  "Last login via" saying which. Logouts aren't logged, so this is the only
  login measure: no session lengths.
- Inactive 30+/90+ days is measured from the later of last login and last activity.
- Names and departments aren't stored for accounts, so those columns are hidden.
  TODO: add users.name and users.department_id in a migration (plus the
  invitation and registration forms), then show both columns and department totals.
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta

INVITATION_LIFETIME = timedelta(days=7)  # AuthService.generate_invite

VIA_SIGN_IN = "Sign-in"
VIA_SWITCH = "Portal switch"

FLAG_NEVER = "Never logged in"
FLAG_INACTIVE_30 = "Inactive 30+ days"
FLAG_INACTIVE_90 = "Inactive 90+ days"
FLAG_PENDING = "Pending invitation"
FLAG_EXPIRED = "Expired invitation"

LOGIN_NOTE = (
    "Logins are recorded but logouts aren't, so last login is the only login measure "
    "and session lengths aren't shown."
)
NOT_RECORDED_NOTE = "Names and departments aren't recorded for accounts yet."


@dataclass(frozen=True)
class Account:
    id: int
    email: str
    role: str
    faculty_id: str | None
    created_at: datetime | None


@dataclass(frozen=True)
class OpenInvitation:
    id: int
    email: str
    role: str
    faculty_id: str | None
    expires_at: datetime


@dataclass(frozen=True)
class Logins:
    last_at: datetime | None = None
    in_period: int = 0


@dataclass(frozen=True)
class Activity:
    total: int = 0
    by_category: dict[str, int] = field(default_factory=dict)
    top_actions: list[tuple[str, int]] = field(default_factory=list)


@dataclass(frozen=True)
class InviteEntry:
    at: datetime
    inviter: str | None


@dataclass
class MemberFacts:
    """Everything the queries found, keyed by lower-cased email (invitations also by id)."""
    accounts: list[Account]
    invitations: list[OpenInvitation]
    faculty_names: dict[str, str] = field(default_factory=dict)
    invite_by_email: dict[str, InviteEntry] = field(default_factory=dict)
    invite_by_id: dict[int, InviteEntry] = field(default_factory=dict)
    # Expiry of each email's latest invitation, used or not: invited = expiry - 7 days.
    invitation_expiry: dict[str, datetime] = field(default_factory=dict)
    sign_ins: dict[str, Logins] = field(default_factory=dict)
    switches_in: dict[str, Logins] = field(default_factory=dict)
    activity: dict[str, Activity] = field(default_factory=dict)
    last_activity: dict[str, datetime] = field(default_factory=dict)
    # Portals named in each person's switches (from and to).
    switch_portals: dict[str, set[str]] = field(default_factory=dict)


def _days_since(moment: datetime | None, now: datetime) -> int | None:
    return None if moment is None else max(0, (now - moment).days)


def _later(a: datetime | None, b: datetime | None) -> datetime | None:
    if a is None:
        return b
    if b is None:
        return a
    return max(a, b)


def _invited(key: str, facts: MemberFacts, invitation_id: int | None = None) -> tuple[datetime | None, str | None, bool]:
    """(when invited, by whom, whether the date was recorded) for an email."""
    entry = facts.invite_by_id.get(invitation_id) if invitation_id is not None else None
    entry = entry or facts.invite_by_email.get(key)
    if entry is not None:
        return entry.at, entry.inviter, True
    expiry = facts.invitation_expiry.get(key)
    return (expiry - INVITATION_LIFETIME if expiry else None), None, False


def build_members(facts: MemberFacts, *, realm_key: str, now: datetime) -> tuple[list[dict], dict]:
    """The member rows, sorted, and the overview."""
    rows: list[dict] = []
    for account in facts.accounts:
        key = account.email.lower()
        sign_in = facts.sign_ins.get(key, Logins())
        switch = facts.switches_in.get(key, Logins())
        if sign_in.last_at is None and switch.last_at is None:
            last_login, via = None, None
        elif switch.last_at is None or (sign_in.last_at is not None and sign_in.last_at >= switch.last_at):
            last_login, via = sign_in.last_at, VIA_SIGN_IN
        else:
            last_login, via = switch.last_at, VIA_SWITCH
        activity = facts.activity.get(key, Activity())
        last_activity = facts.last_activity.get(key)
        last_seen = _later(last_login, last_activity)
        flags = []
        if last_login is None:
            flags.append(FLAG_NEVER)
        idle = _days_since(last_seen, now)
        if idle is not None and idle >= 90:
            flags.append(FLAG_INACTIVE_90)
        elif idle is not None and idle >= 30:
            flags.append(FLAG_INACTIVE_30)
        invited_at, invited_by, recorded = _invited(key, facts)
        rows.append({
            "kind": "member",
            "email": account.email,
            "role": account.role,
            "faculty_id": account.faculty_id,
            "faculty": facts.faculty_names.get(account.faculty_id, account.faculty_id) if account.faculty_id else None,
            "invited_at": invited_at,
            "invited_at_recorded": recorded,
            "invited_by": invited_by,
            "onboarded_at": account.created_at,
            "last_login_at": last_login,
            "last_login_via": via,
            "days_since_last_login": _days_since(last_login, now),
            "sign_ins_in_period": sign_in.in_period,
            "switches_in_period": switch.in_period,
            "total_activities": activity.total,
            "by_category": dict(activity.by_category),
            "top_actions": [{"action": a, "count": n} for a, n in activity.top_actions],
            "last_activity_at": last_activity,
            "portals_used": sorted({realm_key} | facts.switch_portals.get(key, set())),
            "flags": flags,
            "last_seen_at": last_seen,
        })

    invitations: list[dict] = []
    for invitation in facts.invitations:
        key = invitation.email.lower()
        invited_at, invited_by, recorded = _invited(key, facts, invitation.id)
        expired = invitation.expires_at <= now
        invitations.append({
            "kind": "invitation",
            "email": invitation.email,
            "role": invitation.role,
            "faculty_id": invitation.faculty_id,
            "faculty": facts.faculty_names.get(invitation.faculty_id, invitation.faculty_id) if invitation.faculty_id else None,
            "invited_at": invited_at,
            "invited_at_recorded": recorded,
            "invited_by": invited_by,
            "onboarded_at": None,
            "last_login_at": None,
            "last_login_via": None,
            "days_since_last_login": None,
            "sign_ins_in_period": 0,
            "switches_in_period": 0,
            "total_activities": 0,
            "by_category": {},
            "top_actions": [],
            "last_activity_at": None,
            "portals_used": [],
            "flags": [FLAG_EXPIRED if expired else FLAG_PENDING],
            "last_seen_at": None,
            "invitation_status": "Expired" if expired else "Pending",
            "invitation_age_days": _days_since(invited_at, now),
            "expires_at": invitation.expires_at,
        })

    # Last login, newest first; then members who never logged in; then invitations.
    logged_in = sorted((r for r in rows if r["last_login_at"]), key=lambda r: r["last_login_at"], reverse=True)
    never = sorted((r for r in rows if not r["last_login_at"]), key=lambda r: r["email"].lower())
    invitations.sort(key=lambda r: (r["invited_at"] is None, -(r["invited_at"].timestamp() if r["invited_at"] else 0), r["email"].lower()))
    ordered = logged_in + never + invitations
    return ordered, overview(rows, invitations, now)


def overview(members: list[dict], invitations: list[dict], now: datetime) -> dict:
    """Totals by role and faculty; active, inactive and never logged in; pending invitations."""
    by_role: dict[str, int] = {}
    by_faculty: dict[str, int] = {}
    active = inactive = never = 0
    for row in members:
        by_role[row["role"]] = by_role.get(row["role"], 0) + 1
        faculty = row["faculty"] or "No faculty"
        by_faculty[faculty] = by_faculty.get(faculty, 0) + 1
        if row["last_login_at"] is None:
            never += 1
        elif (_days_since(row["last_seen_at"], now) or 0) < 30:
            active += 1
        else:
            inactive += 1
    return {
        "members": len(members),
        "by_role": sorted(by_role.items(), key=lambda kv: (-kv[1], kv[0])),
        "by_faculty": sorted(by_faculty.items(), key=lambda kv: (-kv[1], kv[0])),
        "active_30_days": active,
        "inactive": inactive,
        "never_logged_in": never,
        "pending_invitations": sum(1 for r in invitations if r["invitation_status"] == "Pending"),
        "expired_invitations": sum(1 for r in invitations if r["invitation_status"] == "Expired"),
        "invitations": [
            {
                "email": r["email"],
                "role": r["role"],
                "status": r["invitation_status"],
                "invited_at": r["invited_at"],
                "age_days": r["invitation_age_days"],
            }
            for r in invitations
        ],
    }


def narrow(email: str, role: str, faculty_id: str | None, *, users: tuple[str, ...], roles: tuple[str, ...], faculty: str | None) -> bool:
    """The users, roles and faculty filters decide who is listed."""
    if users and email.lower() not in users:
        return False
    if roles and role not in roles:
        return False
    if faculty and faculty_id != faculty:
        return False
    return True
