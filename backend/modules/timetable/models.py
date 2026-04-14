from datetime import time
from sqlalchemy import String, Integer, ForeignKey, Time, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.base_model import Base

class Faculty(Base):
    __tablename__ = "faculties"
    id: Mapped[str] = mapped_column(String, primary_key=True) # e.g. "ENG"
    name: Mapped[str] = mapped_column(String, unique=True)

class Department(Base):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    faculty_id: Mapped[str] = mapped_column(ForeignKey("faculties.id"))

class Room(Base):
    __tablename__ = "rooms"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    capacity: Mapped[int] = mapped_column(Integer)
    faculty_id: Mapped[str | None] = mapped_column(ForeignKey("faculties.id"), nullable=True)

class Course(Base):
    __tablename__ = "courses"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True, index=True)
    title: Mapped[str] = mapped_column(String)
    credit_load: Mapped[int] = mapped_column(Integer, default=3)
    lecturers: Mapped[list[str]] = mapped_column(ARRAY(String), default=[])
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"))

class ScheduleItem(Base):
    __tablename__ = "schedule_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"))
    room_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=[])
    faculty_id: Mapped[str] = mapped_column(ForeignKey("faculties.id"))
    day_of_week: Mapped[str] = mapped_column(String) # e.g. 'Monday'
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    type: Mapped[str] = mapped_column(String, default="lecture")
    week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    semester_id: Mapped[int | None] = mapped_column(ForeignKey("semesters.id"), nullable=True)
