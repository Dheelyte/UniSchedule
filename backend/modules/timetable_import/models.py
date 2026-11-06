from datetime import datetime

from sqlalchemy import ARRAY, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from core.base_model import Base


class TimetableImport(Base):
    """One timetable imported from a workbook, kept so it can be reverted later."""
    __tablename__ = "timetable_imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    realm_key: Mapped[str] = mapped_column(ForeignKey("realms.key"), index=True)
    # No foreign key: the record of an import outlives a deleted faculty. None: all faculties.
    faculty_id: Mapped[str | None] = mapped_column(String, nullable=True)
    semester_id: Mapped[int] = mapped_column(ForeignKey("semesters.id", ondelete="CASCADE"), index=True)
    item_type: Mapped[str] = mapped_column(String)  # "lecture" | "exam"
    mode: Mapped[str] = mapped_column(String)  # "replace" | "add"
    # Each session was placed in every faculty's timetable (General Studies' lectures).
    place_in_faculties: Mapped[bool] = mapped_column(Boolean, server_default="false")
    # Copied from this earlier semester rather than read from a file.
    source_semester_id: Mapped[int | None] = mapped_column(
        ForeignKey("semesters.id", ondelete="SET NULL"), nullable=True,
    )
    file_name: Mapped[str | None] = mapped_column(String, nullable=True)
    sheet: Mapped[str | None] = mapped_column(String, nullable=True)
    # The sessions it added; kept current when a revert puts a session back under a new id.
    created_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), server_default="{}")
    # The sessions it replaced, as they were, so a revert can put them back.
    replaced: Mapped[list[dict]] = mapped_column(JSONB, server_default="[]")
    left_out: Mapped[int] = mapped_column(Integer, server_default="0")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by_email: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reverted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reverted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reverted_by_email: Mapped[str | None] = mapped_column(String, nullable=True)
    restored_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), server_default="{}")
