"""The SQL behind the Activity Logs export. All aggregation runs in the database,
in Lagos time, over the entries the shared filters match (modules/audit/filters.py).

Every query is scoped like the page: the caller's portal plus cross-portal
entries (CLAUDE.md), and only entries up to the id recorded when the export was
requested, so every read of one export sees the same rows.

Aggregates group on the columns of the `events` subquery: grouping on an
expression with bound parameters (the time zone name, category prefixes) would
fail on Postgres, which sees each parameter as a different value.
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from fastapi import Depends
from sqlalchemy import Date, and_, case, cast, desc, distinct, extract, func, literal, or_, select, true, tuple_
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from core.database import get_db
from modules.audit import categories
from modules.audit.filters import LAGOS, LAGOS_TZ_NAME, AuditFilters, Bounds, conditions, portal_condition
from modules.audit.impersonation import EVENTS as IMPERSONATION_EVENTS
from modules.audit.impersonation import START, STOP, SWITCH, Event
from modules.audit.members import Activity, InviteEntry, Logins
from modules.audit.models import ActivityLog
from modules.audit.timetable_type import timetable_type_expr
from modules.auth.models import Invitation, User
from modules.auth.repository import _in_realm
from modules.timetable.models import Faculty

A = ActivityLog

# Over-time buckets are days up to this many days, weeks beyond.
WEEKLY_AFTER_DAYS = 62
# The Sensitive actions section lists at most this many entries (all are in Raw data).
SENSITIVE_LIST_LIMIT = 2000
TOP_ACTIONS = 3
DECISIONS = ("change_request.approve", "change_request.reject")
EXPORT_ACTION = "activity_log.export"
# Raw data gets one column per details key, up to this many; the rest share one column.
MAX_DETAIL_COLUMNS = 150


def sensitive_condition():
    """Role changes, invitations, editor access handovers, timetable locks and
    unlocks, every deletion, and exports of this log."""
    return or_(
        A.action == "user.role_change",
        A.action.startswith("user.invite", autoescape=True),
        A.action.startswith("editor_access.", autoescape=True),
        A.action.in_(("timetable.lock", "timetable.unlock")),
        A.action.endswith(".delete", autoescape=True),
        A.action == EXPORT_ACTION,
    )


def granularity(first: date, last: date) -> str:
    return "day" if (last - first).days + 1 <= WEEKLY_AFTER_DAYS else "week"


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def who(user_id: int | None, email: str | None) -> str:
    """One person: their account id when recorded, else their email (Event.who)."""
    return str(user_id) if user_id is not None else (email or "").lower()


def _pct(count: int, total: int) -> float:
    return round(count * 100 / total, 1) if total else 0.0


@dataclass(frozen=True)
class ExportScope:
    """What one export reads: the filters, the days they cover, and the last entry id."""
    realm_key: str
    filters: AuditFilters
    bounds: Bounds
    max_id: int


class AnalysisRepository:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    # ---------- Building blocks ----------

    @staticmethod
    def where(scope: ExportScope) -> list:
        return [*conditions(scope.filters, realm_key=scope.realm_key, bounds=scope.bounds), A.id <= scope.max_id]

    def events(self, scope: ExportScope, *more):
        """The matching entries with the columns the aggregates group on."""
        return (
            select(
                A.id.label("id"),
                A.created_at.label("created_at"),
                func.timezone(LAGOS_TZ_NAME, A.created_at).label("local"),
                A.action.label("action"),
                categories.category_expr(A.action).label("category"),
                func.lower(A.user_email).label("email"),
                A.user_id.label("user_id"),
                A.user_role.label("role"),
                A.realm_key.label("realm_key"),
                A.extra.has_key("impersonation").label("impersonated"),
                A.extra["to_realm"].astext.label("to_realm"),
            )
            .where(*self.where(scope), *more)
            .subquery("events")
        )

    async def max_id(self) -> int:
        return (await self.db.execute(select(func.max(A.id)))).scalar() or 0

    async def count(self, scope: ExportScope) -> int:
        return (await self.db.execute(select(func.count()).select_from(A).where(*self.where(scope)))).scalar() or 0

    async def exports_since(self, *, user_id: int, realm_key: str, since: datetime) -> int:
        """How many exports a person requested in this portal since a moment (the rate limit)."""
        stmt = select(func.count()).select_from(A).where(
            A.action == EXPORT_ACTION, A.user_id == user_id, A.realm_key == realm_key, A.created_at >= since
        )
        return (await self.db.execute(stmt)).scalar() or 0

    # ---------- Sections ----------

    async def summary(self, scope: ExportScope) -> dict:
        E = self.events(scope)
        total, users, first, last, impersonated, cross = (await self.db.execute(
            select(
                func.count(),
                func.count(distinct(E.c.email)),
                func.min(E.c.created_at),
                func.max(E.c.created_at),
                func.count().filter(E.c.impersonated.is_(True)),
                func.count().filter(E.c.realm_key.is_(None)),
            ).select_from(E)
        )).one()
        day = cast(E.c.local, Date)
        busiest_day = (await self.db.execute(
            select(day, func.count()).select_from(E).group_by(day).order_by(desc(func.count()), day).limit(1)
        )).first()
        hour = extract("hour", E.c.local)
        busiest_hour = (await self.db.execute(
            select(hour, func.count()).select_from(E).group_by(hour).order_by(desc(func.count()), hour).limit(1)
        )).first()
        common = (await self.db.execute(
            select(E.c.action, func.count()).select_from(E).group_by(E.c.action).order_by(desc(func.count()), E.c.action).limit(1)
        )).first()
        days = (scope.bounds.last - scope.bounds.first).days + 1
        return {
            "total_events": total,
            "unique_users": users,
            "first_event_at": first,
            "last_event_at": last,
            "days": days,
            "events_per_day": round(total / days, 1) if days else 0,
            "busiest_day": {"date": busiest_day[0], "count": busiest_day[1]} if busiest_day else None,
            "busiest_hour": {"hour": int(busiest_hour[0]), "count": busiest_hour[1]} if busiest_hour else None,
            "most_common_action": {"action": common[0], "count": common[1]} if common else None,
            "impersonated_events": impersonated,
            "cross_portal_events": cross,
        }

    async def by_category(self, scope: ExportScope) -> dict:
        E = self.events(scope)
        rows = (await self.db.execute(
            select(E.c.category, E.c.action, func.count()).select_from(E).group_by(E.c.category, E.c.action)
        )).all()
        total = sum(n for _, _, n in rows)
        by_key: dict[str, dict] = {}
        for key, action, n in rows:
            entry = by_key.setdefault(key, {"key": key, "label": categories.label_of(key), "count": 0, "actions": []})
            entry["count"] += n
            entry["actions"].append({"action": action, "count": n, "pct": _pct(n, total)})
        result = sorted(by_key.values(), key=lambda c: (-c["count"], c["label"]))
        for entry in result:
            entry["pct"] = _pct(entry["count"], total)
            entry["actions"].sort(key=lambda a: (-a["count"], a["action"]))
        return {"total": total, "categories": result}

    async def by_user(self, scope: ExportScope) -> dict:
        E = self.events(scope)
        rows = (await self.db.execute(
            select(
                E.c.email,
                func.count(),
                func.max(E.c.created_at),
                func.count().filter(E.c.impersonated.is_(True)),
                func.array_agg(distinct(E.c.role)),
            ).select_from(E).group_by(E.c.email)
        )).all()
        top = await self._top_actions(E)
        emails = [email for email, *_ in rows if email]
        live = set()
        if emails:
            live = set((await self.db.execute(select(func.lower(User.email)).where(func.lower(User.email).in_(emails)))).scalars())
        total = sum(n for _, n, *_ in rows)
        users = [
            {
                "email": email,
                "deleted": bool(email) and email not in live,
                "roles": sorted(r for r in (roles or []) if r),
                "count": n,
                "pct": _pct(n, total),
                "impersonated": impersonated,
                "top_actions": [{"action": a, "count": c} for a, c in top.get(email, [])],
                "last_active_at": last,
            }
            for email, n, last, impersonated, roles in rows
        ]
        users.sort(key=lambda u: (-u["count"], u["email"] or "~"))
        return {"total": total, "users": users}

    async def _top_actions(self, E) -> dict[str | None, list[tuple[str, int]]]:
        rows = (await self.db.execute(
            select(E.c.email, E.c.action, func.count()).select_from(E).group_by(E.c.email, E.c.action)
        )).all()
        by_email: dict[str | None, list[tuple[str, int]]] = {}
        for email, action, n in rows:
            by_email.setdefault(email, []).append((action, n))
        return {email: sorted(items, key=lambda x: (-x[1], x[0]))[:TOP_ACTIONS] for email, items in by_email.items()}

    async def by_role_and_portal(self, scope: ExportScope) -> dict:
        E = self.events(scope)
        roles = (await self.db.execute(select(E.c.role, func.count()).select_from(E).group_by(E.c.role))).all()
        cross = E.c.realm_key.is_(None)
        portals = (await self.db.execute(select(cross, func.count()).select_from(E).group_by(cross))).all()
        switches = (await self.db.execute(
            select(E.c.email, E.c.to_realm, func.count())
            .select_from(E)
            .where(E.c.action == SWITCH)
            .group_by(E.c.email, E.c.to_realm)
        )).all()
        total = sum(n for _, n in roles)
        by_person: dict[str | None, dict] = {}
        for email, to_realm, n in switches:
            entry = by_person.setdefault(email, {"email": email, "count": 0, "to": {}})
            entry["count"] += n
            entry["to"][to_realm or "?"] = entry["to"].get(to_realm or "?", 0) + n
        return {
            "total": total,
            "roles": sorted(
                ({"role": role, "count": n, "pct": _pct(n, total)} for role, n in roles),
                key=lambda r: (-r["count"], r["role"] or "~"),
            ),
            "portals": sorted(
                (
                    {"scope": "cross" if is_cross else "this", "count": n, "pct": _pct(n, total)}
                    for is_cross, n in portals
                ),
                key=lambda p: p["scope"] != "this",
            ),
            "switches": sorted(by_person.values(), key=lambda s: (-s["count"], s["email"] or "~")),
        }

    async def over_time(self, scope: ExportScope) -> dict:
        E = self.events(scope)
        day = cast(E.c.local, Date)
        rows = (await self.db.execute(
            select(day, E.c.category, func.count()).select_from(E).group_by(day, E.c.category)
        )).all()
        dow, hour = extract("isodow", E.c.local), extract("hour", E.c.local)
        cells = (await self.db.execute(select(dow, hour, func.count()).select_from(E).group_by(dow, hour))).all()

        step = granularity(scope.bounds.first, scope.bounds.last)
        first = scope.bounds.first if step == "day" else week_start(scope.bounds.first)
        buckets: dict[date, dict] = {}
        cursor = first
        while cursor <= scope.bounds.last:
            buckets[cursor] = {"start": cursor, "total": 0, "by_category": {}}
            cursor += timedelta(days=1 if step == "day" else 7)
        seen: set[str] = set()
        for when, key, n in rows:
            bucket = buckets.get(when if step == "day" else week_start(when))
            if bucket is None:
                continue
            bucket["total"] += n
            bucket["by_category"][key] = bucket["by_category"].get(key, 0) + n
            seen.add(key)
        heatmap = [[0] * 24 for _ in range(7)]  # Monday first
        for d, h, n in cells:
            heatmap[int(d) - 1][int(h)] += n
        return {
            "granularity": step,
            "categories": [c.key for c in (*categories.CATEGORIES, categories.OTHER) if c.key in seen],
            "buckets": list(buckets.values()),
            "heatmap": heatmap,
        }

    async def sensitive(self, scope: ExportScope) -> dict:
        E = self.events(scope, sensitive_condition())
        counts = (await self.db.execute(
            select(E.c.action, func.count()).select_from(E).group_by(E.c.action).order_by(desc(func.count()), E.c.action)
        )).all()
        entries = (await self.db.execute(
            select(A)
            .where(*self.where(scope), sensitive_condition())
            .order_by(desc(A.created_at), desc(A.id))
            .limit(SENSITIVE_LIST_LIMIT)
        )).scalars().all()
        total = sum(n for _, n in counts)
        return {
            "total": total,
            "by_action": [{"action": a, "count": n} for a, n in counts],
            "entries": [row_dict(entry) for entry in entries],
            "shown": len(entries),
        }

    async def change_requests(self, scope: ExportScope) -> dict:
        E = self.events(scope, A.action.in_(("change_request.create", *DECISIONS)))
        counts = dict((await self.db.execute(select(E.c.action, func.count()).select_from(E).group_by(E.c.action))).all())

        # Each decision against its request's create entry, which may be before the range.
        created = aliased(ActivityLog)
        created_at = (
            select(func.max(created.created_at))
            .where(
                created.action == "change_request.create",
                created.entity_id == A.entity_id,
                created.created_at <= A.created_at,
                or_(created.realm_key == scope.realm_key, created.realm_key.is_(None)),
            )
            .correlate(A)
            .scalar_subquery()
        )
        D = (
            select(A.action.label("action"), (extract("epoch", A.created_at - created_at) / 3600.0).label("hours"))
            .where(*self.where(scope), A.action.in_(DECISIONS))
            .subquery("decisions")
        )
        median = func.percentile_cont(0.5).within_group(D.c.hours)
        overall = (await self.db.execute(select(func.count(D.c.hours), median, func.avg(D.c.hours)).select_from(D))).one()
        outcomes = (await self.db.execute(
            select(D.c.action, func.count(D.c.hours), median).select_from(D).group_by(D.c.action)
        )).all()

        decision = aliased(ActivityLog)
        decided = (
            select(decision.id)
            .where(
                decision.entity_id == A.entity_id,
                decision.action.in_(DECISIONS),
                decision.id <= scope.max_id,
                or_(decision.realm_key == scope.realm_key, decision.realm_key.is_(None)),
            )
            .correlate(A)
            .exists()
        )
        pending = (await self.db.execute(
            select(func.count()).select_from(A).where(*self.where(scope), A.action == "change_request.create", ~decided)
        )).scalar() or 0

        def hours(value):
            return round(float(value), 1) if value is not None else None

        return {
            "created": counts.get("change_request.create", 0),
            "approved": counts.get("change_request.approve", 0),
            "rejected": counts.get("change_request.reject", 0),
            "still_pending": pending,
            "decisions_timed": overall[0],
            "median_hours": hours(overall[1]),
            "mean_hours": hours(overall[2]),
            "by_outcome": [
                {"outcome": "Approved" if action == "change_request.approve" else "Rejected", "timed": n, "median_hours": hours(m)}
                for action, n, m in sorted(outcomes)
            ],
        }

    # ---------- Impersonation ----------

    async def impersonation_events(self, scope: ExportScope) -> list[Event]:
        """Starts and stops in this portal, and portal switches, from a day before the range to a day after."""
        start = scope.bounds.start - timedelta(hours=24)
        end = scope.bounds.end + timedelta(hours=24)
        rows = (await self.db.execute(
            select(A.id, A.created_at, A.action, A.user_id, A.user_email, A.extra)
            .where(
                A.id <= scope.max_id,
                A.created_at >= start,
                A.created_at < end,
                A.action.in_(IMPERSONATION_EVENTS),
                or_(
                    and_(A.action.in_((START, STOP)), A.realm_key == scope.realm_key),
                    and_(A.action == SWITCH, A.realm_key.is_(None)),
                ),
            )
        )).all()
        events = []
        for id_, at, action, user_id, email, extra in rows:
            extra = extra if isinstance(extra, dict) else {}
            events.append(Event(
                id=id_,
                at=at,
                action=action,
                who=who(user_id, email),
                email=email,
                acting_role=extra.get("act_as_role") if action == START else None,
                acting_faculty_id=extra.get("act_as_faculty_id") if action == START else None,
            ))
        return events

    async def impersonated_actions(self, scope: ExportScope) -> list[tuple[str, datetime, str]]:
        """(who, when, action) for each matching entry made while impersonating."""
        rows = (await self.db.execute(
            select(A.user_id, A.user_email, A.created_at, A.action).where(
                *self.where(scope), A.extra.has_key("impersonation"), A.action.notin_((START, STOP))
            )
        )).all()
        return [(who(user_id, email), at, action) for user_id, email, at, action in rows]

    # ---------- Members ----------

    async def faculty_names(self, realm_key: str) -> dict[str, str]:
        return dict((await self.db.execute(select(Faculty.id, Faculty.name).where(Faculty.realm_key == realm_key))).all())

    async def invite_entries(self, scope: ExportScope) -> tuple[dict[str, InviteEntry], dict[int, InviteEntry]]:
        """The latest user.invite entry for each email, and for each invitation id."""
        rows = (await self.db.execute(
            select(A.created_at, A.user_email, A.entity_id, A.extra["email"].astext)
            .where(A.action == "user.invite", portal_condition("both", scope.realm_key), A.id <= scope.max_id)
            .order_by(A.created_at, A.id)
        )).all()
        by_email: dict[str, InviteEntry] = {}
        by_id: dict[int, InviteEntry] = {}
        for at, inviter, entity_id, email in rows:
            entry = InviteEntry(at=at, inviter=inviter)
            if email:
                by_email[email.lower()] = entry
            if entity_id and entity_id.isdigit():
                by_id[int(entity_id)] = entry
        return by_email, by_id

    async def realm_invitation_ids(self, realm_key: str) -> list[int]:
        """Every invitation to this portal (or to a cross-realm role), used or not."""
        rows = await self.db.execute(
            select(Invitation.id).where(_in_realm(Invitation.target_role, Invitation.realm_key, realm_key))
        )
        return list(rows.scalars())

    async def invitation_expiry(self, emails: list[str], realm_invitation_ids: list[int]) -> dict[str, datetime]:
        """Expiry of each email's latest invitation (used or not), among this portal's invitations."""
        if not emails or not realm_invitation_ids:
            return {}
        rows = (await self.db.execute(
            select(func.lower(Invitation.email), func.max(Invitation.expires_at))
            .where(func.lower(Invitation.email).in_(emails), Invitation.id.in_(realm_invitation_ids))
            .group_by(func.lower(Invitation.email))
        )).all()
        return dict(rows)

    async def logins(self, scope: ExportScope) -> tuple[dict[str, Logins], dict[str, Logins]]:
        """Per email: sign-ins to this portal, and switches into it (latest ever, count in the period)."""
        in_period = and_(A.created_at >= scope.bounds.start, A.created_at < scope.bounds.end)
        email = func.lower(A.user_email)

        async def read(*where) -> dict[str, Logins]:
            rows = (await self.db.execute(
                select(email, func.max(A.created_at), func.count().filter(in_period))
                .where(A.id <= scope.max_id, A.user_email.isnot(None), *where)
                .group_by(email)
            )).all()
            return {e: Logins(last_at=last, in_period=n) for e, last, n in rows}

        sign_ins = await read(A.action == "auth.login", A.realm_key == scope.realm_key)
        switches = await read(A.action == SWITCH, A.realm_key.is_(None), A.extra["to_realm"].astext == scope.realm_key)
        return sign_ins, switches

    async def member_activity(self, scope: ExportScope) -> dict[str, Activity]:
        """Per email: matching entries in the period, by category, and the top actions."""
        E = self.events(scope)
        by_category = (await self.db.execute(
            select(E.c.email, E.c.category, func.count()).select_from(E).where(E.c.email.isnot(None)).group_by(E.c.email, E.c.category)
        )).all()
        top = await self._top_actions(E)
        totals: dict[str, dict[str, int]] = {}
        for email, key, n in by_category:
            totals.setdefault(email, {})[key] = n
        return {
            email: Activity(total=sum(cats.values()), by_category=cats, top_actions=top.get(email, []))
            for email, cats in totals.items()
        }

    async def last_activity(self, scope: ExportScope) -> dict[str, datetime]:
        """Per email: their latest entry in this portal's log, whatever the filters."""
        email = func.lower(A.user_email)
        rows = (await self.db.execute(
            select(email, func.max(A.created_at))
            .where(portal_condition("both", scope.realm_key), A.id <= scope.max_id, A.user_email.isnot(None))
            .group_by(email)
        )).all()
        return dict(rows)

    async def switch_portals(self, scope: ExportScope) -> dict[str, set[str]]:
        """Per email: the portals named in their switches."""
        rows = (await self.db.execute(
            select(func.lower(A.user_email), A.extra["from_realm"].astext, A.extra["to_realm"].astext)
            .where(A.action == SWITCH, A.realm_key.is_(None), A.id <= scope.max_id, A.user_email.isnot(None))
            .distinct()
        )).all()
        portals: dict[str, set[str]] = {}
        for email, from_realm, to_realm in rows:
            portals.setdefault(email, set()).update(r for r in (from_realm, to_realm) if r)
        return portals

    # ---------- Raw rows ----------

    async def detail_keys(self, scope: ExportScope) -> list[str]:
        """The columns the details (extra) flatten into: each key, and each key of a nested
        object as "key.sub". Deeper values stay JSON in their column. Rows whose details
        aren't an object (older shapes) go to one "details" column instead.

        Read before the rows, so the Raw data sheet's header can be written first.
        """
        E = (
            select(A.extra.label("extra"))
            .where(*self.where(scope), func.jsonb_typeof(A.extra) == "object")
            .subquery("e")
        )
        k1 = func.jsonb_each(E.c.extra).table_valued("key", "value", joins_implicitly=True).alias("k1")
        nested = case((func.jsonb_typeof(k1.c.value) == "object", k1.c.value), else_=cast(literal("{}"), JSONB))
        k2 = func.jsonb_each(nested).table_valued("key", "value", joins_implicitly=True).lateral("k2")
        path = case((k2.c.key.is_(None), k1.c.key), else_=k1.c.key + "." + k2.c.key)
        stmt = select(path).distinct().select_from(E.join(k1, true()).outerjoin(k2, true()))
        return sorted((await self.db.execute(stmt)).scalars())[:MAX_DETAIL_COLUMNS]


    async def rows(self, scope: ExportScope, *, after: tuple[datetime, int] | None, limit: int) -> list[dict]:
        """Matching entries oldest first, after a (created_at, id) cursor."""
        stmt = (
            select(A, categories.category_expr(A.action), timetable_type_expr())
            .where(*self.where(scope))
            .order_by(A.created_at, A.id)
            .limit(limit)
        )
        if after is not None:
            stmt = stmt.where(tuple_(A.created_at, A.id) > tuple_(*after))
        result = (await self.db.execute(stmt)).all()
        return [row_dict(entry, category=key, timetable_type=kind) for entry, key, kind in result]


def row_dict(entry: ActivityLog, *, category: str | None = None, timetable_type: str | None = None) -> dict:
    """One entry for an export: the effective role it acted as, and the real role behind it."""
    extra = entry.extra
    impersonation = extra.get("impersonation") if isinstance(extra, dict) else None
    impersonation = impersonation if isinstance(impersonation, dict) else None
    return {
        "id": entry.id,
        "created_at": entry.created_at,
        "user_email": entry.user_email,
        "user_role": entry.user_role,
        "real_role": impersonation.get("real_role") if impersonation else entry.user_role,
        "impersonating": impersonation is not None,
        "user_faculty_id": entry.user_faculty_id,
        "portal": entry.realm_key or "Cross-portal",
        "action": entry.action,
        "category": category or categories.category_of(entry.action).key,
        "timetable_type": timetable_type,
        "entity_type": entry.entity_type,
        "entity_id": entry.entity_id,
        "description": entry.description,
        "extra": extra,
    }


def lagos_iso(moment: datetime | None) -> str | None:
    return moment.astimezone(LAGOS).isoformat(timespec="seconds") if moment else None


def jsonable(value):
    """Datetimes as Lagos ISO strings, dates as ISO, sets and tuples as lists."""
    if isinstance(value, datetime):
        return lagos_iso(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [jsonable(v) for v in value]
    return value
