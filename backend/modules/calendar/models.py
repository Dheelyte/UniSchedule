from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from core.base_model import Base


class AcademicSession(Base):
    __tablename__ = "academic_sessions"
    __table_args__ = (
        # One current session per realm.
        Index("uq_academic_sessions_one_current", "realm_key", unique=True, postgresql_where=text("is_current")),
    )
    
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    # Semesters inherit their realm through their session.
    realm_key: Mapped[str] = mapped_column(ForeignKey("realms.key"), server_default="UG", index=True)

class Semester(Base):
    __tablename__ = "semesters"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    session_id: Mapped[int] = mapped_column(ForeignKey("academic_sessions.id"))
