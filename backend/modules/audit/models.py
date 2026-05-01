from datetime import datetime
from sqlalchemy import String, Integer, ForeignKey, DateTime, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from core.base_model import Base


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    __table_args__ = (
        Index("ix_activity_logs_created_at", "created_at"),
        Index("ix_activity_logs_action", "action"),
        Index("ix_activity_logs_entity", "entity_type", "entity_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Snapshot fields so logs survive user deletion / role changes.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    user_email: Mapped[str | None] = mapped_column(String, nullable=True)
    user_role: Mapped[str | None] = mapped_column(String, nullable=True)
    user_faculty_id: Mapped[str | None] = mapped_column(String, nullable=True)

    action: Mapped[str] = mapped_column(String, nullable=False)  # e.g. "course.create"
    entity_type: Mapped[str | None] = mapped_column(String, nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str] = mapped_column(String, nullable=False)
    extra: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
