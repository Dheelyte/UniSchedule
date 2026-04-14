from fastapi import Depends, HTTPException
from modules.notifications.repository import NotificationRepository
from modules.notifications.models import Notification
from modules.notifications.schemas import NotificationCreate

class NotificationService:
    def __init__(self, repo: NotificationRepository = Depends()):
        self.repo = repo

    async def create_notification(self, data: NotificationCreate) -> Notification:
        notif = Notification(
            user_id=data.user_id,
            title=data.title,
            message=data.message,
        )
        return await self.repo.create_notification(notif)
        
    async def create_bulk_notifications(self, data_list: list[NotificationCreate]) -> list[Notification]:
        created = []
        for d in data_list:
            created.append(await self.create_notification(d))
        return created

    async def get_my_notifications(self, current_user: dict) -> list[Notification]:
        user_id = int(current_user["sub"])
        return await self.repo.get_user_notifications(user_id)

    async def mark_as_read(self, notification_id: int, current_user: dict) -> Notification:
        user_id = int(current_user["sub"])
        notif = await self.repo.mark_as_read(notification_id, user_id)
        if not notif:
            raise HTTPException(status_code=404, detail="Notification not found")
        return notif
