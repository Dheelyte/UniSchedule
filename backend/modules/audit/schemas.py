from datetime import datetime
from pydantic import BaseModel, ConfigDict


class ActivityLogResponse(BaseModel):
    id: int
    user_id: int | None
    user_email: str | None
    user_role: str | None
    user_faculty_id: str | None
    action: str
    entity_type: str | None
    entity_id: str | None
    description: str
    extra: dict | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
