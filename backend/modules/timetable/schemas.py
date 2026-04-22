from pydantic import BaseModel, ConfigDict, model_validator
from datetime import time, date as date_type
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

class RoomResponse(RoomCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)

class RoomUpdate(BaseModel):
    name: str | None = None
    capacity: int | None = None
    faculty_id: str | None = None


class CourseCreate(BaseModel):
    code: str
    title: str
    credit_load: int = 3
    lecturers: list[str] = []
    department_id: int | None = None
    scope: str = CourseScope.DEPARTMENTAL.value

    @model_validator(mode='after')
    def validate_scope_department(self):
        if self.scope == CourseScope.UNIVERSITY_WIDE.value:
            self.department_id = None
        elif not self.department_id:
            raise ValueError('department_id is required for departmental and interfaculty courses')
        return self

class CourseResponse(BaseModel):
    id: int
    code: str
    title: str
    credit_load: int
    lecturers: list[str]
    department_id: int | None
    scope: str
    model_config = ConfigDict(from_attributes=True)

class CourseUpdate(BaseModel):
    code: str | None = None
    title: str | None = None
    credit_load: int | None = None
    lecturers: list[str] | None = None
    department_id: int | None = None
    scope: str | None = None


class ScheduleItemCreate(BaseModel):
    course_id: int
    room_ids: list[int]
    faculty_id: str
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
            # Exam blocked slots need a date and time range
            if not self.date:
                raise ValueError("date is required for exam blocked slots")
            if not self.start_time or not self.end_time:
                raise ValueError("start_time and end_time are required for exam blocked slots")
            self.day_of_week = None
            self.type = "EXTRACURRICULAR"
        else:
            # Lecture / Both blocked slots need day_of_week and time
            if not self.day_of_week:
                raise ValueError("day_of_week is required for lecture blocked slots")
            if not self.start_time or not self.end_time:
                raise ValueError("start_time and end_time are required for blocked slots")
            self.date = None
            self.type = "EXTRACURRICULAR"
        # Validate time ordering
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
