from datetime import datetime

from fastapi import Depends
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from modules.audit.filters import AuditFilters, Bounds, conditions, portal_condition
from modules.audit.models import ActivityLog
from modules.auth.models import User


class AuditRepository:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def add(self, log: ActivityLog) -> ActivityLog:
        self.db.add(log)
        await self.db.flush()
        return log

    # ---------- What the filter bar can offer (only what the table shows) ----------

    async def action_counts(self, *, realm_key: str) -> list[tuple[str, int]]:
        """Each action code in the portal's log (its own entries and cross-portal ones), with its count."""
        stmt = (
            select(ActivityLog.action, func.count())
            .where(portal_condition("both", realm_key))
            .group_by(ActivityLog.action)
            .order_by(ActivityLog.action)
        )
        return [(action, count) for action, count in (await self.db.execute(stmt)).all()]

    async def users_seen(self, *, realm_key: str) -> list[tuple[str, bool]]:
        """Each email the portal's log records, and whether an account still has it."""
        seen = (
            select(func.lower(ActivityLog.user_email).label("email"))
            .where(portal_condition("both", realm_key), ActivityLog.user_email.isnot(None))
            .group_by(func.lower(ActivityLog.user_email))
            .subquery()
        )
        has_account = select(User.id).where(func.lower(User.email) == seen.c.email).exists()
        stmt = select(seen.c.email, has_account).order_by(seen.c.email)
        return [(email, bool(live)) for email, live in (await self.db.execute(stmt)).all()]

    async def roles_seen(self, *, realm_key: str) -> list[str]:
        stmt = (
            select(ActivityLog.user_role)
            .where(portal_condition("both", realm_key), ActivityLog.user_role.isnot(None))
            .distinct()
            .order_by(ActivityLog.user_role)
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def first_entry_at(self, *, realm_key: str) -> datetime | None:
        stmt = select(func.min(ActivityLog.created_at)).where(portal_condition("both", realm_key))
        return (await self.db.execute(stmt)).scalar()

    async def session_started_at(self, session_id: int, *, realm_key: str) -> datetime | None:
        """When an academic session became current (its latest calendar.session.current
        entry), else when it was created. None if the log recorded neither."""
        for action in ("calendar.session.current", "calendar.session.create"):
            stmt = (
                select(ActivityLog.created_at)
                .where(
                    ActivityLog.action == action,
                    ActivityLog.entity_type == "academic_session",
                    ActivityLog.entity_id == str(session_id),
                    ActivityLog.realm_key == realm_key,
                )
                .order_by(desc(ActivityLog.created_at))
                .limit(1)
            )
            found = (await self.db.execute(stmt)).scalar()
            if found is not None:
                return found
        return None

    # Last: a method named `list` shadows the builtin in annotations written after it.
    async def list(
        self,
        *,
        realm_key: str,
        filters: AuditFilters,
        bounds: Bounds,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ActivityLog]:
        """The entries a filter matches in the caller's portal, newest first."""
        stmt = (
            select(ActivityLog)
            .where(*conditions(filters, realm_key=realm_key, bounds=bounds))
            # The id breaks ties, so "Load more" pages never repeat or skip a row.
            .order_by(desc(ActivityLog.created_at), desc(ActivityLog.id))
            .offset(offset)
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
