from datetime import time, date as date_type, datetime
import enum
from sqlalchemy import String, Integer, Enum, ForeignKey, Time, ARRAY, Date, Boolean, DateTime, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from core.base_model import Base

class CourseScope(str, enum.Enum):
    DEPARTMENTAL = "DEPARTMENTAL"
    INTERFACULTY = "INTERFACULTY"
    UNIVERSITY_WIDE = "UNIVERSITY_WIDE"

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
    __table_args__ = (UniqueConstraint("name", "faculty_id", name="uq_room_name_faculty"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, index=True)
    capacity: Mapped[int] = mapped_column(Integer)
    faculty_id: Mapped[str | None] = mapped_column(ForeignKey("faculties.id"), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

class Course(Base):
    __tablename__ = "courses"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True, index=True)
    title: Mapped[str] = mapped_column(String)
    credit_load: Mapped[int] = mapped_column(Integer, default=3)
    lecturers: Mapped[list[str]] = mapped_column(ARRAY(String), default=[])
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    scope: Mapped[CourseScope] = mapped_column(Enum(CourseScope), default=CourseScope.DEPARTMENTAL)
    level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    semester: Mapped[str | None] = mapped_column(String, nullable=True)  # "First Semester" | "Second Semester"
    is_cbt_exam: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

class ScheduleItem(Base):
    __tablename__ = "schedule_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"))
    room_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=[])
    faculty_id: Mapped[str | None] = mapped_column(ForeignKey("faculties.id"), nullable=True)
    day_of_week: Mapped[str | None] = mapped_column(String, nullable=True) # None for exam
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    type: Mapped[str] = mapped_column(String, default="lecture")
    week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exam_date: Mapped[date_type | None] = mapped_column(Date, nullable=True)
    semester_id: Mapped[int | None] = mapped_column(ForeignKey("semesters.id"), nullable=True)

class BlockedSlot(Base):
    __tablename__ = "blocked_slots"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String, default="EXTRACURRICULAR")
    date: Mapped[date_type | None] = mapped_column(Date, nullable=True)
    day_of_week: Mapped[str | None] = mapped_column(String, nullable=True)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    applies_to: Mapped[str] = mapped_column(String, default="BOTH", server_default="BOTH")
    semester_id: Mapped[int] = mapped_column(ForeignKey("semesters.id"))

class TimetableLock(Base):
    __tablename__ = "timetable_locks"
    __table_args__ = (UniqueConstraint("semester_id", "timetable_type", name="uq_lock_semester_type"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    semester_id: Mapped[int] = mapped_column(ForeignKey("semesters.id", ondelete="CASCADE"))
    timetable_type: Mapped[str] = mapped_column(String)  # "lecture" | "exam"
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    locked_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class ChangeRequestAction(str, enum.Enum):
    ADD = "ADD"
    MODIFY = "MODIFY"
    REMOVE = "REMOVE"


class ChangeRequestStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class ChangeRequest(Base):
    """A proposed course-schedule change submitted by a non-admin role while a
    timetable is unlocked. Super admins review it; approving auto-applies the
    change to the live timetable."""
    __tablename__ = "change_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    semester_id: Mapped[int] = mapped_column(ForeignKey("semesters.id", ondelete="CASCADE"), index=True)
    timetable_type: Mapped[str] = mapped_column(String)  # "lecture" | "exam"
    action: Mapped[str] = mapped_column(String)  # ADD | MODIFY | REMOVE
    # Target existing item (MODIFY/REMOVE). Null for ADD or if the item was since deleted.
    target_schedule_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("schedule_items.id", ondelete="SET NULL"), nullable=True
    )
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    # Proposed values (mirror ScheduleItem)
    room_ids: Mapped[list[int] | None] = mapped_column(ARRAY(Integer), nullable=True)
    faculty_id: Mapped[str | None] = mapped_column(ForeignKey("faculties.id"), nullable=True)
    day_of_week: Mapped[str | None] = mapped_column(String, nullable=True)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exam_date: Mapped[date_type | None] = mapped_column(Date, nullable=True)
    reason: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default=ChangeRequestStatus.PENDING.value, server_default="PENDING")
    requested_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    review_note: Mapped[str | None] = mapped_column(String, nullable=True)
    resulting_schedule_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("schedule_items.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CourseEnrollment(Base):
    __tablename__ = "course_enrollments"
    __table_args__ = (UniqueConstraint("course_id", "department_id", "level", name="uq_enrollment_course_dept_level"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="CASCADE"), index=True)
    level: Mapped[int] = mapped_column(Integer)
    enrolled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ConflictDismissal(Base):
    """A manually acknowledged/overridden schedule conflict.

    Conflicts are computed on the fly (never stored), so a dismissal is keyed by
    the schedule items involved plus the conflict type. Pairwise conflicts store
    both item ids (normalized so item_a_id <= item_b_id); single-item conflicts
    (e.g. outside-hours warnings) leave item_b_id null. Deleting or moving a
    schedule item cascades the dismissal away, so the conflict re-surfaces.
    """
    __tablename__ = "conflict_dismissals"
    __table_args__ = (
        UniqueConstraint("conflict_type", "item_a_id", "item_b_id", name="uq_dismissal_signature"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    conflict_type: Mapped[str] = mapped_column(String)  # room | course | audience | duplicate | time
    item_a_id: Mapped[int] = mapped_column(ForeignKey("schedule_items.id", ondelete="CASCADE"), index=True)
    item_b_id: Mapped[int | None] = mapped_column(ForeignKey("schedule_items.id", ondelete="CASCADE"), nullable=True, index=True)
    reason: Mapped[str] = mapped_column(String)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
