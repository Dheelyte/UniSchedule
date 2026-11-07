from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from core.base_model import Base

# Who signs a FINAL timetable until a realm's super admin sets it.
DEFAULT_SIGNATORY_TITLE = "Vice-Chancellor"


class TimetableSignoff(Base):
    """The signatory, signature and stamp printed on a realm's FINAL timetables.

    One row per realm and timetable type ("lecture" | "exam"), so lecture and
    exam timetables can be signed by different officers. CBT timetables are exam
    timetables and use the exam row.
    """
    __tablename__ = "timetable_signoffs"
    __table_args__ = (UniqueConstraint("realm_key", "timetable_type", name="uq_signoff_realm_type"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    realm_key: Mapped[str] = mapped_column(ForeignKey("realms.key"), index=True)
    timetable_type: Mapped[str] = mapped_column(String)
    signatory_name: Mapped[str] = mapped_column(String, server_default="")
    signatory_title: Mapped[str] = mapped_column(String, server_default=DEFAULT_SIGNATORY_TITLE)
    # PNG data URLs (data:image/png;base64,...), cleaned up in the browser before upload.
    signature_image: Mapped[str | None] = mapped_column(Text, nullable=True)
    stamp_image: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )


class TimetableVerification(Base):
    """One FINAL issue of a timetable: created when it is locked.

    Its code is printed on every FINAL PDF so anyone can check the copy at
    /verify/<code>. Unlocking marks it reopened; locking again issues a new code,
    so an older printout shows as superseded.
    """
    __tablename__ = "timetable_verifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True, index=True)
    realm_key: Mapped[str] = mapped_column(ForeignKey("realms.key"), index=True)
    semester_id: Mapped[int] = mapped_column(ForeignKey("semesters.id", ondelete="CASCADE"), index=True)
    timetable_type: Mapped[str] = mapped_column(String)
    locked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    locked_by_email: Mapped[str | None] = mapped_column(String, nullable=True)
    reopened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
