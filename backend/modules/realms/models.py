from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from core.base_model import Base


class Realm(Base):
    """A programme with its own calendar, courses, timetables and staff."""
    __tablename__ = "realms"

    key: Mapped[str] = mapped_column(String, primary_key=True)  # e.g. "UG", "ICE"
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    # Live realms are clickable on /realms; the others stay reachable at /login?realm=KEY.
    is_live: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Validated by schemas.RealmConfig on every write and read.
    config: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
