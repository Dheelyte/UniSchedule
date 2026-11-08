from datetime import date as date_type, datetime, time
from typing import Literal

from pydantic import BaseModel

from modules.realms.schemas import RealmConfig
from modules.signoff.schemas import ExportSignoffResponse
from modules.timetable.schemas import (
    BlockedSlotResponse,
    CourseEnrollmentResponse,
    CourseResponse,
    DepartmentResponse,
    FacultyResponse,
    RoomResponse,
    ScheduleItemResponse,
)

TimetableType = Literal["lecture", "exam"]
# What the public download offers: CBT timetables are exam timetables.
DownloadType = Literal["lecture", "exam", "cbt"]


class BundleRealm(BaseModel):
    key: str
    name: str
    config: RealmConfig


class ExportBundle(BaseModel):
    """Everything a timetable export needs, in the shapes the timetable API already returns."""
    realm: BundleRealm
    session_name: str
    semester_id: int
    semester_name: str
    timetable_type: TimetableType
    is_locked: bool
    signoff: ExportSignoffResponse
    schedule_items: list[ScheduleItemResponse]
    # Only the courses the schedule uses, and their enrollments.
    courses: list[CourseResponse]
    enrollments: list[CourseEnrollmentResponse]
    faculties: list[FacultyResponse]
    departments: list[DepartmentResponse]
    rooms: list[RoomResponse]
    blocked_slots: list[BlockedSlotResponse]


# ---------- Public: only what a printed timetable shows ----------

class PublicCourse(BaseModel):
    id: int
    code: str | None = None
    title: str | None = None
    lecturers: list[str] | None = None
    department_id: int | None = None
    scope: str | None = None
    level: int | None = None
    is_cbt_exam: bool | None = None


class PublicRoom(BaseModel):
    id: int
    name: str
    faculty_id: str | None = None
    is_active: bool | None = None


class PublicEnrollment(BaseModel):
    course_id: int
    department_id: int
    level: int


class PublicFaculty(BaseModel):
    id: str
    name: str
    is_special: bool = False


class PublicDepartment(BaseModel):
    id: int
    name: str
    faculty_id: str


class PublicVerification(BaseModel):
    code: str
    locked_at: datetime


class PublicSignoff(BaseModel):
    """No signature or stamp: those are only in staff exports."""
    is_locked: bool
    signatory_name: str | None = None
    signatory_title: str | None = None
    verification: PublicVerification | None = None


class PublicScheduleItem(BaseModel):
    id: int
    course_id: int
    room_ids: list[int] = []
    faculty_id: str | None = None
    day_of_week: str | None = None
    exam_date: date_type | None = None
    start_time: time
    end_time: time
    type: str
    week: int | None = None
    is_online: bool = False


class PublicBlockedSlot(BaseModel):
    id: int
    name: str
    type: str
    date: date_type | None = None
    day_of_week: str | None = None
    start_time: time | None = None
    end_time: time | None = None
    applies_to: str


class PublicExportBundle(BaseModel):
    """A FINAL timetable as anyone may download it: the export bundle without
    anything a printed timetable doesn't show (seat counts, enrollment dates,
    other realms' rooms, signature and stamp images)."""
    realm: BundleRealm
    session_name: str
    semester_id: int
    semester_name: str
    timetable_type: TimetableType
    is_locked: bool
    signoff: PublicSignoff
    schedule_items: list[PublicScheduleItem]
    courses: list[PublicCourse]
    enrollments: list[PublicEnrollment]
    faculties: list[PublicFaculty]
    departments: list[PublicDepartment]
    rooms: list[PublicRoom]
    blocked_slots: list[PublicBlockedSlot]


class PublishedTimetable(BaseModel):
    """A FINAL timetable anyone can download."""
    realm_key: str
    realm_name: str
    session_name: str
    semester_id: int
    semester_name: str
    is_current: bool
    timetable_type: TimetableType
    # None until its first export issues one (timetables locked before codes existed).
    code: str | None
    locked_at: datetime | None


class OptionFaculty(BaseModel):
    id: str
    name: str
    # Units like General Studies and DLI rather than a faculty proper.
    is_special: bool = False


class OptionDepartment(BaseModel):
    id: int
    name: str
    faculty_id: str


class DownloadOptions(BaseModel):
    """The filter choices that have something in a published timetable."""
    faculties: list[OptionFaculty]
    # Every faculty in the realm, with or without a timetable: the index of
    # faculties lists them all and marks the ones not published yet.
    all_faculties: list[OptionFaculty]
    departments: list[OptionDepartment]
    levels: list[int]
