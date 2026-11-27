import logging
from datetime import date

from fastapi import Depends, HTTPException
from modules.audit import categories
from modules.audit.filters import (
    DATE_PRESETS,
    LAGOS,
    LAGOS_TZ_NAME,
    AuditFilters,
    Bounds,
    earliest_export_start,
    lagos_today,
    preset_dates,
    resolve_bounds,
)
from modules.audit.models import ActivityLog
from modules.audit.repository import AuditRepository
from modules.audit.schemas import ActivityLogOptions, DayRange, OptionAction, OptionDepartment, OptionFaculty, OptionSession, OptionUser
from modules.auth.repository import AuthRepository
from modules.calendar.models import AcademicSession
from modules.calendar.repository import CalendarRepository
from modules.timetable.repository import TimetableRepository

log = logging.getLogger(__name__)


class AuditService:
    def __init__(
        self,
        repo: AuditRepository = Depends(),
        auth_repo: AuthRepository = Depends(),
    ):
        self.repo = repo
        self.auth_repo = auth_repo

    async def log(
        self,
        *,
        current_user: dict | None,
        action: str,
        description: str,
        entity_type: str | None = None,
        entity_id: str | int | None = None,
        extra: dict | None = None,
    ) -> ActivityLog | None:
        """Persist an activity log entry. Never raises — audit failures must not
        break the underlying business operation. Returns the entry, or None if it
        couldn't be written."""
        try:
            user_id = None
            user_email = None
            user_role = None
            user_faculty_id = None
            realm_key = None
            if current_user:
                realm_key = current_user.get("realm")
                sub = current_user.get("sub")
                if sub is not None:
                    try:
                        user_id = int(sub)
                    except (TypeError, ValueError):
                        user_id = None
                user_role = current_user.get("role")
                user_faculty_id = current_user.get("faculty_id")
                user_email = current_user.get("email")
                if not user_email and user_id is not None:
                    u = await self.auth_repo.get_user_by_id(user_id)
                    user_email = u.email if u else None
                # Attribute impersonated actions to the real super admin while
                # recording the assumed role/faculty in the effective fields.
                if current_user.get("impersonating"):
                    extra = {
                        **(extra or {}),
                        "impersonation": {
                            "real_role": current_user.get("real_role"),
                            "acting_as_role": current_user.get("role"),
                            "acting_as_faculty_id": current_user.get("faculty_id"),
                        },
                    }

            entry = ActivityLog(
                user_id=user_id,
                user_email=user_email,
                user_role=user_role,
                user_faculty_id=user_faculty_id,
                realm_key=realm_key,
                action=action,
                entity_type=entity_type,
                entity_id=str(entity_id) if entity_id is not None else None,
                description=description,
                extra=extra,
            )
            return await self.repo.add(entry)
        except Exception as e:  # pragma: no cover — defensive
            log.exception("Failed to write activity log: %s", e)
            return None


class ActivityLogReader:
    """Reads for the Activity Logs page: the filtered list and the filter bar's choices.

    Kept apart from AuditService, which every module uses to write entries.
    """

    def __init__(
        self,
        repo: AuditRepository = Depends(),
        calendar_repo: CalendarRepository = Depends(),
        timetable_repo: TimetableRepository = Depends(),
    ):
        self.repo = repo
        self.calendar_repo = calendar_repo
        self.timetable_repo = timetable_repo

    async def current_session(self, realm_key: str) -> tuple[AcademicSession | None, date | None]:
        """The portal's current academic session and the Lagos day it started, if recorded."""
        sessions = await self.calendar_repo.get_sessions(realm_key=realm_key)
        session = next((s for s in sessions if s.is_current), None)
        if session is None:
            return None, None
        started = await self.repo.session_started_at(session.id, realm_key=realm_key)
        return session, started.astimezone(LAGOS).date() if started else None

    async def bounds(self, filters: AuditFilters, realm_key: str, today: date | None = None) -> Bounds:
        """The days a filter covers, or a 422 when a session preset can't be resolved."""
        today = today or lagos_today()
        session_start = None
        if filters.preset == "session":
            _, session_start = await self.current_session(realm_key)
        try:
            return resolve_bounds(filters, today, session_start)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error))

    async def list(self, *, realm_key: str, filters: AuditFilters, limit: int = 100, offset: int = 0) -> list[ActivityLog]:
        bounds = await self.bounds(filters, realm_key)
        return await self.repo.list(realm_key=realm_key, filters=filters, bounds=bounds, limit=limit, offset=offset)

    async def options(self, realm_key: str) -> ActivityLogOptions:
        today = lagos_today()
        session, session_start = await self.current_session(realm_key)
        presets: dict[str, DayRange | None] = {}
        for preset in DATE_PRESETS:
            try:
                first, last = preset_dates(preset, today, session_start)
                presets[preset] = DayRange(start=first, end=last)
            except ValueError:
                presets[preset] = None
        faculties = sorted(await self.timetable_repo.get_faculties(realm_key=realm_key), key=lambda f: f.name)
        departments = sorted(await self.timetable_repo.get_departments(realm_key=realm_key), key=lambda d: d.name)
        return ActivityLogOptions(
            timezone=LAGOS_TZ_NAME,
            today=today,
            presets=presets,
            last_12_months=DayRange(start=earliest_export_start(today), end=today),
            first_entry_at=await self.repo.first_entry_at(realm_key=realm_key),
            session=OptionSession(id=session.id, name=session.name, start=session_start) if session else None,
            actions=[
                OptionAction(code=code, category=categories.category_of(code).key, count=count)
                for code, count in await self.repo.action_counts(realm_key=realm_key)
            ],
            users=[OptionUser(email=email, deleted=not live) for email, live in await self.repo.users_seen(realm_key=realm_key)],
            roles=await self.repo.roles_seen(realm_key=realm_key),
            faculties=[OptionFaculty(id=f.id, name=f.name) for f in faculties],
            departments=[OptionDepartment(id=d.id, name=d.name, faculty_id=d.faculty_id) for d in departments],
        )
