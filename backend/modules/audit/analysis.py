"""The SQL behind the Activity Logs export. All aggregation runs in the database,
in Lagos time, over the entries the shared filters match (modules/audit/filters.py).

Every query is scoped like the page: the caller's portal plus cross-portal
entries (CLAUDE.md), and only entries up to the id recorded when the export was
requested, so every read of one export sees the same rows.

Aggregates group on the columns of the `events` subquery: grouping on an
expression with bound parameters (the time zone name, category prefixes) would
fail on Postgres, which sees each parameter as a different value.
"""
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta

from fastapi import Depends
from sqlalchemy import Date, String, Time, and_, case, cast, desc, distinct, extract, func, literal, literal_column, or_, select, true, tuple_
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from core.database import get_db
from modules.audit import categories
from modules.audit.filters import LAGOS, LAGOS_TZ_NAME, AuditFilters, Bounds, conditions, day_bounds, portal_condition
from modules.audit.impersonation import EVENTS as IMPERSONATION_EVENTS
from modules.audit.impersonation import START, STOP, SWITCH, Event
from modules.audit.members import Activity, InviteEntry, Logins
from modules.audit.models import ActivityLog
from modules.audit.timetable_type import timetable_type_expr
from modules.auth.models import Invitation, RoleEnum, User
from modules.auth.repository import _in_realm
from modules.calendar.models import AcademicSession, Semester
from modules.realms.models import Realm
from modules.editor_access.models import EditorHandover
from modules.realms.defaults import DEFAULT_REALM_KEY
from modules.realms.schemas import WEEKDAYS
from modules.timetable.models import BlockedSlot, Course, ScheduleItem
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


OUT_OF_HOURS_LIMIT = 500
UNUSUAL_LIST_LIMIT = 500
# Unusual activity: this many deletions by one person within this many minutes,
MASS_DELETE_COUNT, MASS_DELETE_MINUTES = 10, 60
# or this many changes (anything but sign-ins and exports) within this many minutes.
BURST_COUNT, BURST_MINUTES = 60, 10
# Course history: the busiest courses, and the changes listed for each.
COURSES_LIMIT, COURSE_ENTRIES_LIMIT = 100, 50

LOCK, UNLOCK, EDIT_REQUEST = "timetable.lock", "timetable.unlock", "timetable.edit_request"
# Edits listed per reopening (every one is counted, and every one is in Raw data).
LOCKED_EDITS_LIMIT = 200


def _timetable_edit(kind: str):
    """A change to a lecture or exam timetable's schedule (items, imports, exam shifts)."""
    return or_(A.action.startswith(f"schedule_item.{kind}.", autoescape=True), A.action == f"timetable.{kind}.shift")


def _in_semester(semester_id: int | None):
    """An entry about this semester: the semester it records, or for older
    schedule item entries that don't record one, the item's own semester."""
    if semester_id is None:
        return literal(False)
    sid = str(semester_id)
    return or_(
        A.extra["semester_id"].astext == sid,
        and_(A.entity_type == "semester", A.entity_id == sid),
        and_(
            A.entity_type == "schedule_item",
            A.extra["semester_id"].astext.is_(None),
            A.entity_id.in_(select(cast(ScheduleItem.id, String)).where(ScheduleItem.semester_id == semester_id)),
        ),
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
    # Set when no one the report covers can impersonate: entries a super admin made
    # while acting as someone else, and the impersonation events themselves, are
    # left out, so the report doesn't reveal that impersonation exists.
    exclude_impersonated: bool = False


class AnalysisRepository:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    # ---------- Building blocks ----------

    @staticmethod
    def where(scope: ExportScope) -> list:
        found = [*conditions(scope.filters, realm_key=scope.realm_key, bounds=scope.bounds), A.id <= scope.max_id]
        if scope.exclude_impersonated:
            found += [
                # `extra ? 'impersonation'` is NULL when extra is NULL, hence the coalesce.
                ~func.coalesce(A.extra.has_key("impersonation"), False),
                A.action.notin_(IMPERSONATION_EVENTS),
            ]
        return found

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
            "previous": await self._previous_totals(scope),
        }

    @staticmethod
    def previous_scope(scope: ExportScope) -> ExportScope:
        """The same filters over the same number of days, just before the period."""
        days = (scope.bounds.last - scope.bounds.first).days + 1
        last = scope.bounds.first - timedelta(days=1)
        return replace(scope, bounds=Bounds(last - timedelta(days=days - 1), last))

    async def _previous_totals(self, scope: ExportScope) -> dict:
        previous = self.previous_scope(scope)
        E = self.events(previous)
        total, users = (await self.db.execute(select(func.count(), func.count(distinct(E.c.email))).select_from(E))).one()
        return {"first": previous.bounds.first, "last": previous.bounds.last, "total_events": total, "unique_users": users}

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
        P = self.events(self.previous_scope(scope))
        previous = dict((await self.db.execute(select(P.c.category, func.count()).select_from(P).group_by(P.c.category))).all())
        for entry in result:
            entry["pct"] = _pct(entry["count"], total)
            entry["previous"] = previous.get(entry["key"], 0)
            entry["actions"].sort(key=lambda a: (-a["count"], a["action"]))
        # Categories that only had events in the previous period.
        for key, n in sorted(previous.items(), key=lambda x: -x[1]):
            if key not in by_key:
                result.append({"key": key, "label": categories.label_of(key), "count": 0, "pct": 0.0, "previous": n, "actions": []})
        return {"total": total, "previous_total": sum(previous.values()), "categories": result}

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

    # ---------- Out of hours ----------

    async def working_hours(self, realm_key: str) -> dict:
        """The portal's working days and hours, from its calendar config (its
        lecture and exam days, and its day start and end), and its holidays:
        dates blocked for the whole day."""
        realm = await self.db.get(Realm, realm_key) or await self.db.get(Realm, DEFAULT_REALM_KEY)
        config = (realm.config if realm else None) or {}
        days = set(config.get("lecture_days") or []) | set(config.get("exam_days") or [])
        holidays = (await self.db.execute(
            select(BlockedSlot.date, func.min(BlockedSlot.name))
            .join(Semester, Semester.id == BlockedSlot.semester_id)
            .join(AcademicSession, AcademicSession.id == Semester.session_id)
            .where(AcademicSession.realm_key == realm_key, BlockedSlot.date.is_not(None), BlockedSlot.start_time.is_(None))
            .group_by(BlockedSlot.date)
            .order_by(BlockedSlot.date)
        )).all()
        return {
            "days": [d for d in WEEKDAYS if d in days] or WEEKDAYS[:5],
            "start": config.get("day_start") or "08:00",
            "end": config.get("day_end") or "18:00",
            "holidays": [{"date": d, "name": name} for d, name in holidays],
        }

    async def out_of_hours(self, scope: ExportScope) -> dict:
        """Entries made outside the portal's working hours, on a non-working day, or on a holiday."""
        hours = await self.working_hours(scope.realm_key)
        E = self.events(scope)
        weekday = func.trim(func.to_char(E.c.local, "FMDay"))
        clock = cast(E.c.local, Time)
        start, end = time.fromisoformat(hours["start"]), time.fromisoformat(hours["end"])
        holiday_dates = [h["date"] for h in hours["holidays"]]
        reason = case(
            (cast(E.c.local, Date).in_(holiday_dates) if holiday_dates else literal(False), literal("Holiday")),
            (weekday.notin_(hours["days"]), literal("Non-working day")),
            (or_(clock < start, clock >= end), literal("Outside working hours")),
            else_=None,
        ).label("reason")
        flagged = select(E.c.id, E.c.email, E.c.local, reason).select_from(E).subquery("flagged")
        kept = flagged.c.reason.is_not(None)
        by_reason = (await self.db.execute(
            select(flagged.c.reason, func.count()).where(kept).group_by(flagged.c.reason).order_by(desc(func.count()))
        )).all()
        by_user = (await self.db.execute(
            select(flagged.c.email, func.count()).where(kept).group_by(flagged.c.email).order_by(desc(func.count()), flagged.c.email).limit(50)
        )).all()
        listed = (await self.db.execute(
            select(A, flagged.c.reason).join(flagged, flagged.c.id == A.id).where(kept)
            .order_by(desc(A.created_at), desc(A.id)).limit(OUT_OF_HOURS_LIMIT)
        )).all()
        total = sum(n for _, n in by_reason)
        all_events = await self.count(scope)
        names = {h["date"]: h["name"] for h in hours["holidays"]}
        entries = []
        for entry, why in listed:
            row = row_dict(entry)
            day = entry.created_at.astimezone(LAGOS).date()
            row["reason"] = f"Holiday ({names[day]})" if why == "Holiday" and day in names else why
            entries.append(row)
        return {
            "working_hours": {**hours, "holidays": [h for h in hours["holidays"] if scope.bounds.first <= h["date"] <= scope.bounds.last]},
            "total": total,
            "pct": _pct(total, all_events),
            "by_reason": [{"reason": r, "count": n} for r, n in by_reason],
            "by_user": [{"email": e, "count": n} for e, n in by_user],
            "entries": entries,
            "shown": len(entries),
        }

    # ---------- Unusual activity ----------

    async def _bursts(self, scope: ExportScope, condition, minutes: int, threshold: int) -> list[dict]:
        """Times one person made `threshold` or more matching entries within `minutes`."""
        E = self.events(scope, condition)
        in_window = literal_column(
            f"count(*) OVER (PARTITION BY email ORDER BY created_at "
            f"RANGE BETWEEN interval '{int(minutes)} minutes' PRECEDING AND CURRENT ROW)"
        ).label("n")
        counted = select(E.c.email, E.c.created_at, in_window).select_from(E).subquery("counted")
        peaks = (await self.db.execute(
            select(counted.c.email, counted.c.created_at, counted.c.n)
            .where(counted.c.n >= threshold)
            .order_by(counted.c.email, counted.c.created_at)
        )).all()
        bursts: list[dict] = []
        window = timedelta(minutes=minutes)
        for email, at, n in peaks:
            last = bursts[-1] if bursts else None
            if last and last["email"] == email and at - last["until"] <= window:
                last["until"] = at
                last["peak"] = max(last["peak"], n)
            else:
                bursts.append({"email": email, "from": at - window, "until": at, "peak": n})
        for b in bursts:
            b["count"] = (await self.db.execute(
                select(func.count()).select_from(E).where(E.c.email == b["email"], E.c.created_at > b["from"], E.c.created_at <= b["until"])
            )).scalar()
            # Start at the first entry, not at the edge of the window.
            b["from"] = (await self.db.execute(
                select(func.min(E.c.created_at)).where(E.c.email == b["email"], E.c.created_at > b["from"], E.c.created_at <= b["until"])
            )).scalar()
        return sorted(bursts, key=lambda b: b["from"])

    async def unusual(self, scope: ExportScope) -> dict:
        """Patterns worth a second look: many deletions in a short time, a burst
        of changes, and schedule changes outside the person's own faculty."""
        changes = and_(~A.action.startswith("auth.", autoescape=True), A.action != EXPORT_ACTION)
        deletions = await self._bursts(scope, A.action.endswith(".delete", autoescape=True), MASS_DELETE_MINUTES, MASS_DELETE_COUNT)
        bursts = await self._bursts(scope, changes, BURST_MINUTES, BURST_COUNT)

        item_faculty = func.coalesce(A.extra["faculty_id"].astext, ScheduleItem.faculty_id)
        outside = (await self.db.execute(
            select(A, item_faculty)
            .outerjoin(ScheduleItem, cast(ScheduleItem.id, String) == A.entity_id)
            .where(
                *self.where(scope),
                A.entity_type == "schedule_item",
                A.user_faculty_id.is_not(None),
                item_faculty.is_not(None),
                item_faculty != A.user_faculty_id,
            )
            .order_by(desc(A.created_at), desc(A.id))
            .limit(UNUSUAL_LIST_LIMIT)
        )).all()
        other_faculty = []
        for entry, faculty in outside:
            row = row_dict(entry)
            row["item_faculty_id"] = faculty
            other_faculty.append(row)
        return {
            "rules": {
                "mass_delete": {"count": MASS_DELETE_COUNT, "minutes": MASS_DELETE_MINUTES},
                "burst": {"count": BURST_COUNT, "minutes": BURST_MINUTES},
            },
            "mass_deletions": deletions,
            "bursts": bursts,
            "other_faculty": other_faculty,
            "total": len(deletions) + len(bursts) + len(other_faculty),
        }

    # ---------- Editor access handovers ----------

    async def handovers(self, scope: ExportScope) -> dict:
        """Every handover held at some point in the period, from the handover records."""
        start, end = day_bounds(scope.bounds.first, scope.bounds.last)
        ended_by = aliased(User)
        H = EditorHandover
        cond = [H.realm_key == scope.realm_key, H.started_at < end, or_(H.ended_at.is_(None), H.ended_at >= start)]
        if scope.filters.faculty:
            cond.append(H.faculty_id == scope.filters.faculty)
        if scope.filters.users:
            cond.append(or_(func.lower(H.granted_by_email).in_(scope.filters.users), func.lower(H.holder_email).in_(scope.filters.users)))
        rows = (await self.db.execute(
            select(H, Faculty.name, ended_by.email)
            .outerjoin(Faculty, Faculty.id == H.faculty_id)
            .outerjoin(ended_by, ended_by.id == H.ended_by_id)
            .where(*cond)
            .order_by(H.started_at, H.id)
        )).all()
        now = datetime.now(LAGOS)
        result = []
        for h, faculty_name, ended_by_email in rows:
            until = h.ended_at or min(end, now)
            result.append({
                "faculty_id": h.faculty_id,
                "faculty_name": faculty_name,
                "granted_by": h.granted_by_email,
                "holder": h.holder_email,
                "started_at": h.started_at,
                "ended_at": h.ended_at,
                "end_reason": h.end_reason,
                "ended_by": ended_by_email,
                "days_held": round((until - h.started_at).total_seconds() / 86400, 1),
                "active": h.ended_at is None,
            })
        return {
            "total": len(result),
            "active": sum(1 for r in result if r["active"]),
            "started_in_period": sum(1 for r in result if r["started_at"] >= start),
            "handovers": result,
        }

    # ---------- Course history ----------

    async def course_history(self, scope: ExportScope) -> dict:
        """Every change to each course's lecture and exam slots, busiest courses first."""
        code = func.coalesce(
            A.extra["course_code"].astext,
            Course.code,
            func.substring(A.description, r" for ([^ ]+)"),
        ).label("code")
        base = (
            select(A.id.label("id"), code)
            .outerjoin(ScheduleItem, cast(ScheduleItem.id, String) == A.entity_id)
            .outerjoin(Course, Course.id == ScheduleItem.course_id)
            .where(*self.where(scope), A.entity_type == "schedule_item", A.action.startswith("schedule_item.", autoescape=True))
            .subquery("course_entries")
        )
        counts = (await self.db.execute(
            select(base.c.code, func.count()).where(base.c.code.is_not(None))
            .group_by(base.c.code).order_by(desc(func.count()), base.c.code)
        )).all()
        shown = [c for c, _ in counts[:COURSES_LIMIT]]
        entries: dict[str, list] = {c: [] for c in shown}
        if shown:
            ranked = (
                select(base.c.id, base.c.code, func.row_number().over(partition_by=base.c.code, order_by=base.c.id).label("n"))
                .where(base.c.code.in_(shown))
                .subquery("ranked")
            )
            rows = (await self.db.execute(
                select(A, ranked.c.code).join(ranked, ranked.c.id == A.id)
                .where(ranked.c.n <= COURSE_ENTRIES_LIMIT).order_by(A.created_at, A.id)
            )).all()
            for entry, c in rows:
                entries[c].append(row_dict(entry))
        return {
            "total_courses": len(counts),
            "total_changes": sum(n for _, n in counts),
            "courses": [
                {"code": c, "changes": n, "entries": entries.get(c, [])}
                for c, n in counts[:COURSES_LIMIT]
            ],
        }

    # ---------- Exports of this log ----------

    async def exports(self, scope: ExportScope) -> dict:
        entries = (await self.db.execute(
            select(A).where(*self.where(scope), A.action == EXPORT_ACTION).order_by(desc(A.created_at), desc(A.id))
        )).scalars().all()
        rows = []
        for e in entries:
            extra = e.extra if isinstance(e.extra, dict) else {}
            rows.append({
                "id": e.id,
                "created_at": e.created_at,
                "user_email": e.user_email,
                "format": extra.get("format"),
                "from": extra.get("from"),
                "to": extra.get("to"),
                "row_count": extra.get("row_count"),
                "sections": extra.get("sections") or [],
                "mask_emails": extra.get("mask_emails"),
                "filters": extra.get("filters") or {},
            })
        return {
            "total": len(rows),
            "unmasked": sum(1 for r in rows if r["mask_emails"] is False),
            "exports": rows,
        }

    # ---------- Verification ----------

    async def export_by_code(self, code: str) -> tuple[ActivityLog, str] | None:
        """The export entry a report's verification code was issued with, and its
        portal's name. Public and cross-portal by design, like a timetable's code."""
        row = (await self.db.execute(
            select(A, Realm.name)
            .join(Realm, Realm.key == A.realm_key)
            .where(A.action == EXPORT_ACTION, A.extra["verification_code"].astext == code)
            .order_by(A.id)
            .limit(1)
        )).first()
        return (row[0], row[1]) if row else None

    # ---------- Locked timetables ----------

    async def locked_timetables(self, scope: ExportScope) -> dict:
        """Each time a locked (FINAL) timetable was reopened in the period: who
        unlocked it and when, any edit request before that, the edits made while
        it was open, and who locked it again.

        The reopenings come from this portal's lock entries, whoever made them;
        the edits counted are the ones the export's filters keep.
        """
        start, end = day_bounds(scope.bounds.first, scope.bounds.last)
        lock_cond = [
            A.realm_key == scope.realm_key,
            A.entity_type == "timetable_lock",
            A.action.in_((LOCK, UNLOCK, EDIT_REQUEST)),
            A.created_at < end,
            A.id <= scope.max_id,
        ]
        if scope.filters.timetable_type != "all":
            lock_cond.append(A.entity_id.endswith(f":{scope.filters.timetable_type}", autoescape=True))
        entries = (await self.db.execute(select(A).where(*lock_cond).order_by(A.created_at, A.id))).scalars().all()

        # Walk each timetable's entries in order: an unlock opens a window, a lock closes it.
        windows, open_by, requests_by = [], {}, {}
        for e in entries:
            key = e.entity_id or ""
            if e.action == EDIT_REQUEST:
                reason = e.extra.get("reason") if isinstance(e.extra, dict) else None
                requests_by.setdefault(key, []).append({"at": e.created_at, "by": e.user_email, "reason": reason})
            elif e.action == UNLOCK and key not in open_by:
                open_by[key] = {"key": key, "unlocked_at": e.created_at, "unlocked_by": e.user_email,
                                "requests": requests_by.pop(key, []), "relocked_at": None, "relocked_by": None}
            elif e.action == LOCK:
                requests_by.pop(key, None)
                window = open_by.pop(key, None)
                if window:
                    window.update(relocked_at=e.created_at, relocked_by=e.user_email)
                    windows.append(window)
        windows += open_by.values()
        windows = [w for w in windows if w["relocked_at"] is None or w["relocked_at"] >= start]
        windows.sort(key=lambda w: w["unlocked_at"])

        semester_ids = {int(w["key"].split(":")[0]) for w in windows if w["key"].split(":")[0].isdigit()}
        names = {}
        if semester_ids:
            names = {
                sid: (session, semester)
                for sid, session, semester in (await self.db.execute(
                    select(Semester.id, AcademicSession.name, Semester.name)
                    .join(AcademicSession, AcademicSession.id == Semester.session_id)
                    .where(Semester.id.in_(semester_ids), AcademicSession.realm_key == scope.realm_key)
                )).all()
            }

        result = []
        for w in windows:
            semester, _, kind = w["key"].partition(":")
            sid = int(semester) if semester.isdigit() else None
            until = w["relocked_at"] or end
            edited = [
                *self.where(scope),
                A.created_at >= w["unlocked_at"],
                A.created_at <= until,
                _timetable_edit(kind),
                _in_semester(sid),
            ]
            by_user = (await self.db.execute(
                select(A.user_email, func.count()).where(*edited).group_by(A.user_email).order_by(desc(func.count()), A.user_email)
            )).all()
            edits = (await self.db.execute(
                select(A).where(*edited).order_by(A.created_at, A.id).limit(LOCKED_EDITS_LIMIT)
            )).scalars().all()
            relocked = w["relocked_at"] is not None and w["relocked_at"] < end
            session_name, semester_name = names.get(sid, (None, None))
            result.append({
                "semester_id": sid,
                "session_name": session_name,
                "semester_name": semester_name,
                "timetable_type": kind,
                "unlocked_at": w["unlocked_at"],
                "unlocked_by": w["unlocked_by"],
                "relocked_at": w["relocked_at"] if relocked else None,
                "relocked_by": w["relocked_by"] if relocked else None,
                # Hours it stayed open, or None while it's still open at the end of the period.
                "open_hours": round((w["relocked_at"] - w["unlocked_at"]).total_seconds() / 3600, 1) if relocked else None,
                "requests": w["requests"],
                "edit_count": sum(n for _, n in by_user),
                "editors": [{"email": email, "count": n} for email, n in by_user],
                "edits": [row_dict(entry) for entry in edits],
            })
        return {
            "total": len(result),
            "edits": sum(r["edit_count"] for r in result),
            "still_open": sum(1 for r in result if r["relocked_at"] is None),
            "without_request": sum(1 for r in result if not r["requests"]),
            "reopenings": result,
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

    async def can_impersonate(self, emails: tuple[str, ...]) -> bool:
        """Whether any of these people can impersonate: a super admin account today,
        or anyone who has started an impersonation (a former super admin's sessions
        still belong in their report)."""
        if not emails:
            return False
        is_admin = select(User.id).where(func.lower(User.email).in_(emails), User.role == RoleEnum.SUPER_ADMIN).exists()
        has_started = select(A.id).where(A.action == START, func.lower(A.user_email).in_(emails)).exists()
        return bool((await self.db.execute(select(or_(is_admin, has_started)))).scalar())

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
