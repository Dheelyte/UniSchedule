from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from core.base_model import Base


class AcademicSession(Base):
    __tablename__ = "academic_sessions"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)

class Semester(Base):
    __tablename__ = "semesters"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    session_id: Mapped[int] = mapped_column(ForeignKey("academic_sessions.id"))
