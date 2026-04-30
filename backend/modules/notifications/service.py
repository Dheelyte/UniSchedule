from fastapi import Depends, HTTPException, BackgroundTasks
from modules.notifications.repository import NotificationRepository
from modules.notifications.models import Notification
from modules.notifications.schemas import NotificationCreate
from modules.auth.repository import AuthRepository
from core.mail import EmailService

class NotificationService:
    def __init__(
        self,
        repo: NotificationRepository = Depends(),
        auth_repo: AuthRepository = Depends(),
    ):
        self.repo = repo
        self.auth_repo = auth_repo

    async def create_notification(self, data: NotificationCreate) -> Notification:
        notif = Notification(
            user_id=data.user_id,
            title=data.title,
            message=data.message,
            link=data.link,
        )
        return await self.repo.create_notification(notif)

    async def create_bulk_notifications(self, data_list: list[NotificationCreate]) -> list[Notification]:
        created = []
        for d in data_list:
            created.append(await self.create_notification(d))
        return created

    async def notify(
        self,
        user_ids: list[int],
        title: str,
        message: str,
        link: str | None = None,
        send_email: bool = False,
        background_tasks: BackgroundTasks | None = None,
    ) -> list[Notification]:
        """Single fan-out for in-app notifications + optional email.

        Future triggers (lock changes, item edits, invitations accepted, ...) call this one helper.
        Email is dispatched via BackgroundTasks when provided so SMTP doesn't block the request.
        """
        if not user_ids:
            return []

        notifs = [
            Notification(user_id=uid, title=title, message=message, link=link)
            for uid in user_ids
        ]
        for n in notifs:
            await self.repo.create_notification(n)

        if send_email:
            users = await self.auth_repo.get_users_by_ids(user_ids)
            emails = [u.email for u in users if u.email]
            if emails:
                if background_tasks is not None:
                    background_tasks.add_task(
                        EmailService.send_generic_notification, emails, title, message, link
                    )
                else:
                    await EmailService.send_generic_notification(emails, title, message, link)

        return notifs

    async def get_my_notifications(self, current_user: dict) -> list[Notification]:
        user_id = int(current_user["sub"])
        return await self.repo.get_user_notifications(user_id)

    async def mark_as_read(self, notification_id: int, current_user: dict) -> Notification:
        user_id = int(current_user["sub"])
        notif = await self.repo.mark_as_read(notification_id, user_id)
        if not notif:
            raise HTTPException(status_code=404, detail="Notification not found")
        return notif
