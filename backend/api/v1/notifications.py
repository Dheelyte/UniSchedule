from fastapi import APIRouter, Depends
from modules.notifications.service import NotificationService
from modules.notifications.schemas import NotificationResponse
from api.dependencies.auth import get_current_user

router = APIRouter(prefix="/notifications", tags=["Notifications"])

@router.get("", response_model=list[NotificationResponse])
async def get_my_notifications(
    service: NotificationService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.get_my_notifications(user)

@router.patch("/{notification_id}/read", response_model=NotificationResponse)
async def mark_notification_as_read(
    notification_id: int,
    service: NotificationService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.mark_as_read(notification_id, user)
