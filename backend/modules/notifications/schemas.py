from pydantic import BaseModel, ConfigDict
from datetime import datetime

class NotificationCreate(BaseModel):
    user_id: int
    title: str
    message: str
    link: str | None = None

class NotificationResponse(BaseModel):
    id: int
    user_id: int
    title: str
    message: str
    is_read: bool
    link: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
