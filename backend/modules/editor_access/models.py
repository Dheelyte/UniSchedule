from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from core.base_model import Base


class EditorHandover(Base):
    """A Faculty Editor handing their editor access to a Faculty Viewer.

    While a row is active (`ended_at` is NULL) the original editor is a Faculty
    Viewer and the holder is a Faculty Editor; only the original editor (or a
    super admin) may end it. Ending it never deletes the row, so it doubles as
    the history of who held a faculty's editor access and when.
    """
    __tablename__ = "editor_handovers"
    __table_args__ = (
        # A person can hand over, or hold, at most one access at a time.
        Index(
            "uq_editor_handovers_active_granted_by", "granted_by_id",
            unique=True, postgresql_where=text("ended_at IS NULL"),
        ),
        Index(
            "uq_editor_handovers_active_holder", "holder_id",
            unique=True, postgresql_where=text("ended_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    realm_key: Mapped[str] = mapped_column(ForeignKey("realms.key"), index=True)
    faculty_id: Mapped[str] = mapped_column(String, index=True)
    # The original editor, who alone may retract or redirect the access.
    granted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Who holds the editor access now.
    holder_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Snapshots, so the history still reads after an account is deleted.
    granted_by_email: Mapped[str] = mapped_column(String)
    holder_email: Mapped[str] = mapped_column(String)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # "returned" | "redirected" | "reversed_by_admin"
    end_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    ended_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
