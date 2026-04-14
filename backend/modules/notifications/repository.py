from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from core.database import get_db
from modules.notifications.models import Notification

class NotificationRepository:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def create_notification(self, notification: Notification) -> Notification:
        self.db.add(notification)
        await self.db.flush()
        return notification

    async def get_user_notifications(self, user_id: int) -> list[Notification]:
        result = await self.db.execute(
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
        )
        return list(result.scalars().all())

    async def mark_as_read(self, notification_id: int, user_id: int) -> Notification | None:
        result = await self.db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                Notification.user_id == user_id
            )
        )
        notif = result.scalars().first()
        if notif:
            notif.is_read = True
            await self.db.flush()
        return notif
