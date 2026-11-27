"""The filters of the Activity Logs page and its export.

One model, AuditFilters, read from the page's query string. GET /audit/logs and
the export endpoints both use it, and conditions() turns it into WHERE clauses,
so the table and an export always agree on what matches.

Dates and times are Africa/Lagos throughout. Presets are resolved here, on the
server, so the page and the export can't disagree about what "Last 7 days" means.

Mirrors src/app/activity/filters.js (the URL parameters are the same names).
"""
import calendar
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from sqlalchemy import Time, and_, case, cast, func, or_, select

from modules.audit import categories
from modules.audit.models import ActivityLog
from modules.audit.timetable_type import matches_timetable_type, safe_int
from modules.auth.models import RoleEnum
from modules.timetable.models import ChangeRequest, Course, Department, ScheduleItem

LAGOS_TZ_NAME = "Africa/Lagos"


def _lagos_zone():
    try:
        return ZoneInfo(LAGOS_TZ_NAME)
    except ZoneInfoNotFoundError:
        # No time zone database (Windows without the tzdata package). Lagos is
        # UTC+01:00 all year, with no daylight saving, so a fixed offset is exact.
        return timezone(timedelta(hours=1), "WAT")


LAGOS = _lagos_zone()

Preset = Literal["today", "yesterday", "this_week", "last_7_days", "this_month", "last_30_days", "session", "custom", "all"]
# The presets that resolve to dates on their own (custom needs its dates; all has none).
DATE_PRESETS = ("today", "yesterday", "this_week", "last_7_days", "this_month", "last_30_days", "session")

_ACTION_CODE = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+)*$")
_ACTION_PREFIX = re.compile(r"^[a-z0-9_.]{1,64}$")
_FACULTY_ID = re.compile(r"^[\w-]{1,64}$")
_TIME_WINDOW = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*$")
_ROLES = {role.value for role in RoleEnum}
MAX_KEYWORD_LENGTH = 200
MAX_LIST_LENGTH = 200


# ---------- Dates in Lagos ----------

def lagos_now() -> datetime:
    return datetime.now(timezone.utc).astimezone(LAGOS)


def lagos_today(now: datetime | None = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(LAGOS).date()


def preset_dates(preset: str, today: date, session_start: date | None = None) -> tuple[date, date] | None:
    """The first and last Lagos day a preset covers, both inclusive. None for "all".

    Weeks start on Monday; "Last 7 days" and "Last 30 days" include today.
    """
    if preset == "today":
        return today, today
    if preset == "yesterday":
        day = today - timedelta(days=1)
        return day, day
    if preset == "this_week":
        return today - timedelta(days=today.weekday()), today
    if preset == "last_7_days":
        return today - timedelta(days=6), today
    if preset == "this_month":
        return today.replace(day=1), today
    if preset == "last_30_days":
        return today - timedelta(days=29), today
    if preset == "session":
        if session_start is None:
            raise ValueError("The current academic session's start isn't recorded, so this preset isn't available.")
        return min(session_start, today), today
    if preset == "all":
        return None
    raise ValueError(f"{preset} is not a preset with fixed dates")


def day_bounds(first: date, last: date) -> tuple[datetime, datetime]:
    """Lagos midnight at the start of `first`, and at the end of `last` (exclusive)."""
    return (
        datetime.combine(first, time.min, tzinfo=LAGOS),
        datetime.combine(last + timedelta(days=1), time.min, tzinfo=LAGOS),
    )


def earliest_export_start(last: date) -> date:
    """The first day a 12-month export ending on `last` may start on (exports only)."""
    year = last.year - 1
    day = min(last.day, calendar.monthrange(year, last.month)[1])
    return date(year, last.month, day) + timedelta(days=1)


def parse_time_window(text: str) -> tuple[time, time]:
    """"08:00-17:00" -> (08:00, 17:00). The start is included, the end is not.

    A start after the end crosses midnight ("22:00-06:00"); equal times are refused.
    """
    match = _TIME_WINDOW.match(text or "")
    if not match:
        raise ValueError("Time of day must look like 08:00-17:00.")
    h1, m1, h2, m2 = (int(part) for part in match.groups())
    if h1 > 23 or h2 > 23 or m1 > 59 or m2 > 59:
        raise ValueError("Time of day must look like 08:00-17:00.")
    start, end = time(h1, m1), time(h2, m2)
    if start == end:
        raise ValueError("The time of day must start and end at different times.")
    return start, end


def format_time_window(window: tuple[time, time] | None) -> str | None:
    if not window:
        return None
    return f"{window[0].strftime('%H:%M')}-{window[1].strftime('%H:%M')}"


# ---------- The filter model ----------

def _split(value) -> list[str]:
    """A list from repeated parameters, comma-separated values, or both."""
    if value is None:
        return []
    items = [value] if isinstance(value, str) else list(value)
    out: list[str] = []
    for item in items:
        for part in str(item).split(","):
            part = part.strip()
            if part and part not in out:
                out.append(part)
    return out


class AuditFilters(BaseModel):
    """What the Activity Logs page (and an export of it) is filtered by.

    Field aliases are the query-string names the page puts in its URL.
    """
    model_config = ConfigDict(populate_by_name=True, extra="forbid", frozen=True)

    preset: Preset = Field("all", alias="range")
    date_from: date | None = Field(None, alias="from")
    date_to: date | None = Field(None, alias="to")
    # Custom ranges only. Start included, end not; a start after the end crosses midnight.
    time_window: tuple[time, time] | None = Field(None, alias="time")
    timetable_type: Literal["all", "lecture", "exam"] = Field("all", alias="type")
    categories: tuple[str, ...] = Field((), alias="cat")
    actions: tuple[str, ...] = Field((), alias="action")
    # Matched on the email recorded with each entry, so deleted accounts still match.
    users: tuple[str, ...] = Field((), alias="user")
    # The effective role: what an impersonating super admin acted as.
    roles: tuple[str, ...] = Field((), alias="role")
    faculty: str | None = None
    department: int | None = Field(None, alias="dept")
    q: str | None = None
    portal: Literal["both", "this", "cross"] = "both"
    # The page's original parameters, still accepted.
    action_prefix: str | None = None
    user_id: int | None = None

    @field_validator("time_window", mode="before")
    @classmethod
    def _time_window(cls, value):
        if value is None or value == "":
            return None
        if isinstance(value, str):
            return parse_time_window(value)
        return value

    @field_validator("categories", mode="before")
    @classmethod
    def _categories(cls, value):
        return categories.normalize(_split(value))

    @field_validator("actions", mode="before")
    @classmethod
    def _actions(cls, value):
        codes = _split(value)
        if len(codes) > MAX_LIST_LENGTH:
            raise ValueError("Too many actions selected.")
        for code in codes:
            if not _ACTION_CODE.match(code) or len(code) > 100:
                raise ValueError(f"Unknown action: {code}")
        return tuple(codes)

    @field_validator("users", mode="before")
    @classmethod
    def _users(cls, value):
        emails = [email.lower() for email in _split(value)]
        if len(emails) > MAX_LIST_LENGTH:
            raise ValueError("Too many users selected.")
        if any(len(email) > 320 for email in emails):
            raise ValueError("That email address is too long.")
        return tuple(dict.fromkeys(emails))

    @field_validator("roles", mode="before")
    @classmethod
    def _roles(cls, value):
        roles = _split(value)
        for role in roles:
            if role not in _ROLES:
                raise ValueError(f"Unknown role: {role}")
        return tuple(roles)

    @field_validator("faculty", mode="before")
    @classmethod
    def _faculty(cls, value):
        if value is None or str(value).strip() in ("", "ALL"):
            return None
        value = str(value).strip()
        if not _FACULTY_ID.match(value):
            raise ValueError("Unknown faculty.")
        return value

    @field_validator("department", mode="before")
    @classmethod
    def _department(cls, value):
        if value is None or str(value).strip() in ("", "ALL"):
            return None
        return value

    @field_validator("q", mode="before")
    @classmethod
    def _keyword(cls, value):
        if value is None:
            return None
        value = str(value).strip()
        if len(value) > MAX_KEYWORD_LENGTH:
            raise ValueError(f"Keep the keyword under {MAX_KEYWORD_LENGTH} characters.")
        return value or None

    @field_validator("action_prefix", mode="before")
    @classmethod
    def _action_prefix(cls, value):
        if value is None or value == "":
            return None
        if not _ACTION_PREFIX.match(str(value)):
            raise ValueError("Unknown action prefix.")
        return value

    @model_validator(mode="after")
    def _range(self):
        if self.preset == "custom":
            if self.date_from is None or self.date_to is None:
                raise ValueError("A custom range needs both a start and an end date.")
            if self.date_from > self.date_to:
                raise ValueError("The custom range ends before it starts.")
        else:
            if self.date_from is not None or self.date_to is not None:
                raise ValueError("Start and end dates are only used with a custom range.")
            if self.time_window is not None:
                raise ValueError("A time of day can only be set on a custom range.")
        return self


def validation_message(error: ValidationError) -> str:
    """The first problem in words a person can act on."""
    first = error.errors()[0]
    message = str(first.get("msg", "Invalid filters."))
    for noise in ("Value error, ", "Assertion failed, "):
        message = message.removeprefix(noise)
    if first.get("type") in ("literal_error", "int_parsing", "date_from_datetime_parsing", "date_parsing", "date_from_datetime_inexact"):
        field = ".".join(str(part) for part in first.get("loc", ()))
        message = f"Invalid {field}: {message}"
    return message


def parse_filters(data: dict) -> AuditFilters:
    """AuditFilters from query or JSON values, or a 422 with a readable reason."""
    try:
        return AuditFilters.model_validate(data)
    except ValidationError as error:
        raise HTTPException(status_code=422, detail=validation_message(error))


def filters_to_query(filters: AuditFilters) -> dict:
    """The filters as query values under the page's URL names, defaults left out.

    parse_filters() reads the result back to the same filters.
    """
    data = filters.model_dump(by_alias=True, exclude_defaults=True, mode="json")
    if filters.time_window:
        data["time"] = format_time_window(filters.time_window)
    return data


def filters_from_query(
    preset: str = Query("all", alias="range"),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    time_window: str | None = Query(None, alias="time"),
    timetable_type: str = Query("all", alias="type"),
    cat: list[str] = Query([]),
    action: list[str] = Query([]),
    user: list[str] = Query([]),
    role: list[str] = Query([]),
    faculty: str | None = Query(None),
    dept: str | None = Query(None),
    q: str | None = Query(None),
    portal: str = Query("both"),
    action_prefix: str | None = Query(None),
    user_id: int | None = Query(None),
) -> AuditFilters:
    """FastAPI dependency: the filters in the request's query string."""
    return parse_filters({
        "range": preset,
        "from": date_from or None,
        "to": date_to or None,
        "time": time_window or None,
        "type": timetable_type,
        "cat": cat,
        "action": action,
        "user": user,
        "role": role,
        "faculty": faculty,
        "dept": dept,
        "q": q,
        "portal": portal,
        "action_prefix": action_prefix,
        "user_id": user_id,
    })


# ---------- Resolved dates ----------

@dataclass(frozen=True)
class Bounds:
    """The Lagos days a filter covers (None: no limit) and the instants they start and end."""
    first: date | None
    last: date | None

    @property
    def start(self) -> datetime | None:
        return day_bounds(self.first, self.first)[0] if self.first else None

    @property
    def end(self) -> datetime | None:
        return day_bounds(self.last, self.last)[1] if self.last else None


def resolve_bounds(filters: AuditFilters, today: date, session_start: date | None = None) -> Bounds:
    """The days a filter covers. Raises ValueError for the session preset when its start isn't known."""
    if filters.preset == "custom":
        return Bounds(filters.date_from, filters.date_to)
    dates = preset_dates(filters.preset, today, session_start)
    return Bounds(*dates) if dates else Bounds(None, None)


# ---------- WHERE clauses ----------

def portal_condition(portal: str, realm_key: str):
    """This portal's entries, entries that belong to no portal, or both (CLAUDE.md: never another portal's)."""
    if portal == "this":
        return ActivityLog.realm_key == realm_key
    if portal == "cross":
        return ActivityLog.realm_key.is_(None)
    return or_(ActivityLog.realm_key == realm_key, ActivityLog.realm_key.is_(None))


def time_window_condition(start: time, end: time):
    """Each entry's own Lagos time of day: [start, end), or from start / before end across midnight."""
    local_time = cast(func.timezone(LAGOS_TZ_NAME, ActivityLog.created_at), Time)
    if start < end:
        return and_(local_time >= start, local_time < end)
    return or_(local_time >= start, local_time < end)


def _when(condition, value):
    return case((condition, value), else_=None)


def department_expr():
    """The department an entry concerns, where one is recorded or can be looked up:
    the department itself, extra.department_id, or the department of the course the
    entry names (directly, through extra.course_id, a schedule item or a change request).

    A deleted course can't be looked up, so its later entries only match through
    what they recorded themselves.
    """
    A = ActivityLog
    course_department = lambda course_id: (  # noqa: E731
        select(Course.department_id).where(Course.id == course_id).correlate(A).scalar_subquery()
    )
    via_schedule_item = (
        select(Course.department_id)
        .join(ScheduleItem, ScheduleItem.course_id == Course.id)
        .where(ScheduleItem.id == safe_int(A.entity_id))
        .correlate(A)
        .scalar_subquery()
    )
    via_change_request = (
        select(Course.department_id)
        .join(ChangeRequest, ChangeRequest.course_id == Course.id)
        .where(ChangeRequest.id == safe_int(A.entity_id))
        .correlate(A)
        .scalar_subquery()
    )
    return func.coalesce(
        _when(A.entity_type == "department", safe_int(A.entity_id)),
        safe_int(A.extra["department_id"].astext),
        _when(A.entity_type == "course", course_department(safe_int(A.entity_id))),
        course_department(safe_int(A.extra["course_id"].astext)),
        _when(A.entity_type == "schedule_item", via_schedule_item),
        _when(A.entity_type == "change_request", via_change_request),
    )


def faculty_condition(faculty_id: str):
    """The user acted for this faculty, the entry names it, or it concerns one of its departments."""
    A = ActivityLog
    return or_(
        A.user_faculty_id == faculty_id,
        A.extra["faculty_id"].astext == faculty_id,
        and_(A.entity_type == "faculty", A.entity_id == faculty_id),
        department_expr().in_(select(Department.id).where(Department.faculty_id == faculty_id)),
    )


def conditions(filters: AuditFilters, *, realm_key: str, bounds: Bounds) -> list:
    """The WHERE clauses for a filter, in the caller's portal."""
    A = ActivityLog
    clauses = [portal_condition(filters.portal, realm_key)]
    if bounds.start is not None:
        clauses.append(A.created_at >= bounds.start)
    if bounds.end is not None:
        clauses.append(A.created_at < bounds.end)
    if filters.time_window:
        clauses.append(time_window_condition(*filters.time_window))
    if filters.timetable_type != "all":
        clauses.append(matches_timetable_type(filters.timetable_type))
    category_prefixes = categories.prefixes(filters.categories)
    if category_prefixes:
        clauses.append(or_(*(A.action.startswith(prefix, autoescape=True) for prefix in category_prefixes)))
    if filters.action_prefix:
        clauses.append(A.action.startswith(filters.action_prefix, autoescape=True))
    if filters.actions:
        clauses.append(A.action.in_(filters.actions))
    if filters.users:
        clauses.append(func.lower(A.user_email).in_(filters.users))
    if filters.user_id is not None:
        clauses.append(A.user_id == filters.user_id)
    if filters.roles:
        clauses.append(A.user_role.in_(filters.roles))
    if filters.faculty:
        clauses.append(faculty_condition(filters.faculty))
    if filters.department is not None:
        clauses.append(department_expr() == filters.department)
    if filters.q:
        clauses.append(A.description.icontains(filters.q, autoescape=True))
    return clauses
