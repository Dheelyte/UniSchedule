from pydantic import BaseModel, ConfigDict
from datetime import time

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
    department_id: int

class CourseResponse(CourseCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)

class CourseUpdate(BaseModel):
    code: str | None = None
    title: str | None = None
    credit_load: int | None = None
    lecturers: list[str] | None = None
    department_id: int | None = None


class ScheduleItemCreate(BaseModel):
    course_id: int
    room_ids: list[int]
    faculty_id: str
    day_of_week: str
    start_time: time
    end_time: time
    type: str = "lecture"
    week: int | None = None
    semester_id: int | None = None

class ScheduleItemUpdate(BaseModel):
    room_ids: list[int] | None = None
    day_of_week: str | None = None
    start_time: time | None = None
    end_time: time | None = None

class ScheduleItemResponse(ScheduleItemCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)
