from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from datetime import time, date as date_type, datetime
from typing import Literal
from modules.timetable.models import CourseScope

class FacultyCreate(BaseModel):
    id: str
    name: str

class FacultyResponse(FacultyCreate):
    model_config = ConfigDict(from_attributes=True)

class FacultyUpdate(BaseModel):
    name: str | None = None


class DepartmentCreate(BaseModel):
    name: str
    faculty_id: str

class DepartmentResponse(DepartmentCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)

class DepartmentUpdate(BaseModel):
    name: str | None = None
    faculty_id: str | None = None


class RoomCreate(BaseModel):
    name: str
    capacity: int
    faculty_id: str | None = None
    display_order: int = 0

class RoomResponse(RoomCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)

class RoomUpdate(BaseModel):
    name: str | None = None
    capacity: int | None = None
    faculty_id: str | None = None
    display_order: int | None = None

class RoomReorderItem(BaseModel):
    id: int
    display_order: int

class RoomReorderRequest(BaseModel):
    rooms: list[RoomReorderItem]


_VALID_SEMESTERS = {"First Semester", "Second Semester"}


class CourseCreate(BaseModel):
    code: str
    title: str | None = None
    credit_load: int = 3
    lecturers: list[str] = []
    department_id: int | None = None
    scope: str = CourseScope.DEPARTMENTAL.value
    level: int | None = None
    semester: str | None = None
    is_cbt_exam: bool = False

    @field_validator('semester')
    @classmethod
    def validate_semester(cls, v: str | None) -> str | None:
        if v is None or v == '':
            return None
        if v not in _VALID_SEMESTERS:
            raise ValueError('semester must be "First Semester" or "Second Semester"')
        return v

    @field_validator('code')
    @classmethod
    def validate_code_no_spaces(cls, v: str) -> str:
        v = (v or '').strip()
        if not v:
            raise ValueError('Course code is required')
        if any(ch.isspace() for ch in v):
            raise ValueError('Course code must be a single word with no spaces (e.g. "CSC301")')
        return v

    @model_validator(mode='after')
    def validate_scope_department(self):
        if self.scope == CourseScope.UNIVERSITY_WIDE.value:
            self.department_id = None
        elif not self.department_id:
            raise ValueError('department_id is required for departmental and interfaculty courses')
        if self.scope in (CourseScope.DEPARTMENTAL.value, CourseScope.INTERFACULTY.value) and self.level is None:
            raise ValueError('level is required for departmental and interfaculty courses')
        return self

class CourseResponse(BaseModel):
    id: int
    code: str | None = None
    title: str | None = None
    credit_load: int | None = None
    lecturers: list[str] | None = None
    department_id: int | None = None
    scope: str | None = None
    level: int | None = None
    semester: str | None = None
    is_cbt_exam: bool | None = None
    model_config = ConfigDict(from_attributes=True)

class CourseUpdate(BaseModel):
    code: str | None = None
    title: str | None = None
    credit_load: int | None = None
    lecturers: list[str] | None = None
    department_id: int | None = None
    scope: str | None = None
    level: int | None = None
    semester: str | None = None
    is_cbt_exam: bool | None = None

    @field_validator('code')
    @classmethod
    def validate_code_no_spaces(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError('Course code cannot be empty')
        if any(ch.isspace() for ch in v):
            raise ValueError('Course code must be a single word with no spaces (e.g. "CSC301")')
        return v

    @field_validator('semester')
    @classmethod
    def validate_semester(cls, v: str | None) -> str | None:
        if v is None or v == '':
            return None
        if v not in _VALID_SEMESTERS:
            raise ValueError('semester must be "First Semester" or "Second Semester"')
        return v


class ScheduleItemCreate(BaseModel):
    course_id: int
    room_ids: list[int]
    faculty_id: str | None = None
    day_of_week: str | None = None
    start_time: time
    end_time: time
    type: str = "lecture"
    week: int | None = None
    exam_date: date_type | None = None
    semester_id: int | None = None

class ScheduleItemUpdate(BaseModel):
    room_ids: list[int] | None = None
    day_of_week: str | None = None
    exam_date: date_type | None = None
    start_time: time | None = None
    end_time: time | None = None

class ScheduleItemResponse(ScheduleItemCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)


class BlockedSlotCreate(BaseModel):
    name: str
    type: str | None = None  # Auto-derived; kept for backward compat
    date: date_type | None = None
    day_of_week: str | None = None
    start_time: time | None = None
    end_time: time | None = None
    applies_to: str = "BOTH"  # BOTH, LECTURE_ONLY, EXAM_ONLY
    semester_id: int

    @model_validator(mode='after')
    def validate_fields(self):
        if self.applies_to == "EXAM_ONLY":
            if not self.date:
                raise ValueError("date is required for exam blocked slots")
            self.day_of_week = None
            self.type = "EXTRACURRICULAR"
        else:
            if not self.day_of_week:
                raise ValueError("day_of_week is required for lecture blocked slots")
            self.date = None
            self.type = "EXTRACURRICULAR"
        # Times must be both present (time-bounded) or both absent (whole day)
        if (self.start_time is None) != (self.end_time is None):
            raise ValueError("start_time and end_time must both be provided, or both omitted for a whole-day block")
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValueError("start_time must be before end_time")
        return self

class BlockedSlotResponse(BaseModel):
    id: int
    name: str
    type: str
    date: date_type | None
    day_of_week: str | None
    start_time: time | None
    end_time: time | None
    applies_to: str
    semester_id: int
    model_config = ConfigDict(from_attributes=True)


class TimetableLockResponse(BaseModel):
    semester_id: int
    timetable_type: Literal["lecture", "exam"]
    is_locked: bool
    locked_by: int | None
    locked_at: datetime | None
    model_config = ConfigDict(from_attributes=True)


class TimetableLockUpdate(BaseModel):
    is_locked: bool


class EditRequestCreate(BaseModel):
    reason: str | None = None


class ChangeRequestCreate(BaseModel):
    timetable_type: Literal["lecture", "exam"]
    action: Literal["ADD", "MODIFY", "REMOVE"]
    course_id: int
    target_schedule_item_id: int | None = None
    room_ids: list[int] | None = None
    faculty_id: str | None = None
    day_of_week: str | None = None
    start_time: time | None = None
    end_time: time | None = None
    week: int | None = None
    exam_date: date_type | None = None
    reason: str | None = None
    semester_id: int | None = None

    @model_validator(mode="after")
    def _validate(self):
        if self.action in ("MODIFY", "REMOVE") and self.target_schedule_item_id is None:
            raise ValueError("target_schedule_item_id is required for MODIFY/REMOVE requests")
        if self.action in ("ADD", "MODIFY"):
            if self.start_time is None or self.end_time is None:
                raise ValueError("start_time and end_time are required for ADD/MODIFY requests")
            if self.end_time <= self.start_time:
                raise ValueError("end_time must be after start_time")
        return self


class ChangeRequestReview(BaseModel):
    approve: bool
    note: str | None = None


class ChangeRequestResponse(BaseModel):
    id: int
    semester_id: int
    timetable_type: str
    action: str
    course_id: int | None
    target_schedule_item_id: int | None
    room_ids: list[int] | None
    faculty_id: str | None
    day_of_week: str | None
    start_time: time | None
    end_time: time | None
    week: int | None
    exam_date: date_type | None
    reason: str | None
    status: str
    requested_by: int | None
    reviewed_by: int | None
    review_note: str | None
    resulting_schedule_item_id: int | None
    created_at: datetime
    reviewed_at: datetime | None
    # Enriched display fields (populated by the service)
    course_code: str | None = None
    course_title: str | None = None
    requester_email: str | None = None
    model_config = ConfigDict(from_attributes=True)


class CourseEnrollmentCreate(BaseModel):
    course_id: int
    department_id: int
    level: int


class CourseEnrollmentResponse(BaseModel):
    id: int
    course_id: int
    department_id: int
    level: int
    enrolled_at: datetime
    model_config = ConfigDict(from_attributes=True)


ConflictType = Literal["room", "course", "audience", "duplicate", "time"]


class ConflictDismissalSignature(BaseModel):
    conflict_type: ConflictType
    item_a_id: int
    item_b_id: int | None = None


class ConflictDismissalCreate(ConflictDismissalSignature):
    reason: str = Field(..., min_length=1, max_length=500)


class ConflictDismissalBulkCreate(BaseModel):
    department_id: int
    reason: str = Field(..., min_length=1, max_length=500)
    dismissals: list[ConflictDismissalSignature]


class ConflictDismissalResponse(BaseModel):
    id: int
    conflict_type: str
    item_a_id: int
    item_b_id: int | None
    reason: str
    created_by: int | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
