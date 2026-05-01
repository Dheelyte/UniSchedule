from fastapi import Depends
from sqlalchemy import desc, select
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
        limit: int = 100,
        offset: int = 0,
        action_prefix: str | None = None,
        user_id: int | None = None,
    ) -> list[ActivityLog]:
        stmt = select(ActivityLog).order_by(desc(ActivityLog.created_at))
        if action_prefix:
            stmt = stmt.where(ActivityLog.action.like(f"{action_prefix}%"))
        if user_id is not None:
            stmt = stmt.where(ActivityLog.user_id == user_id)
        stmt = stmt.offset(offset).limit(limit)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())
