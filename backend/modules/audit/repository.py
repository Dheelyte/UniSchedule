from fastapi import Depends
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from modules.audit.models import ActivityLog


class AuditRepository:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def add(self, log: ActivityLog) -> ActivityLog:
        self.db.add(log)
        await self.db.flush()
        return log

    async def list(
        self,
        *,
        realm_key: str,
        limit: int = 100,
        offset: int = 0,
        action_prefix: str | None = None,
        user_id: int | None = None,
    ) -> list[ActivityLog]:
        # The realm's entries, plus those that belong to no single realm.
        stmt = (
            select(ActivityLog)
            .where(or_(ActivityLog.realm_key == realm_key, ActivityLog.realm_key.is_(None)))
            .order_by(desc(ActivityLog.created_at))
        )
        if action_prefix:
            stmt = stmt.where(ActivityLog.action.like(f"{action_prefix}%"))
        if user_id is not None:
            stmt = stmt.where(ActivityLog.user_id == user_id)
        stmt = stmt.offset(offset).limit(limit)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
