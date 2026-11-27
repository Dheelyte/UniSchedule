"""Page previews (step-by-step tours): whether a user has them on, and which
pages they've already been shown. Stored on the account so it follows them
across devices. Always the signed-in user's own account, even while a super
admin is acting as another role."""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_user
from core.database import get_db
from modules.auth.models import User

router = APIRouter(prefix="/tours", tags=["Page previews"])

PAGE_KEY = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
# Far more than there are pages; just a bound on what one account can store.
MAX_SEEN = 200


class TourState(BaseModel):
    enabled: bool
    seen: list[str]


class TourSettings(BaseModel):
    enabled: bool


class TourSeen(BaseModel):
    page: str

    @field_validator("page")
    @classmethod
    def _key(cls, value: str) -> str:
        if not PAGE_KEY.match(value):
            raise ValueError("not a page key")
        return value


async def _me(user: dict, db: AsyncSession) -> User:
    account = await db.get(User, int(user["sub"]))
    if account is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return account


def _state(account: User) -> TourState:
    return TourState(enabled=account.tours_enabled, seen=list(account.tours_seen or []))


@router.get("", response_model=TourState)
async def get_tours(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return _state(await _me(user, db))


@router.put("", response_model=TourState)
async def set_tours(data: TourSettings, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Turn previews on or off everywhere. Turning them back on starts afresh,
    so each page plays its preview again."""
    account = await _me(user, db)
    if data.enabled and not account.tours_enabled:
        account.tours_seen = []
    account.tours_enabled = data.enabled
    await db.commit()
    return _state(account)


@router.post("/seen", response_model=TourState)
async def mark_seen(data: TourSeen, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    account = await _me(user, db)
    seen = list(account.tours_seen or [])
    if data.page not in seen and len(seen) < MAX_SEEN:
        account.tours_seen = [*seen, data.page]
        await db.commit()
    return _state(account)
