from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class ImportAnswers(BaseModel):
    # Code as written in the sheet -> course id, or None to leave that code out.
    courses: dict[str, int | None] = Field(default_factory=dict)
    # Venue as written in the sheet -> room ids; [] schedules it without a room.
    venues: dict[str, list[int]] = Field(default_factory=dict)
    # Faculty as written in the sheet -> faculty id, or None to leave that line out.
    faculties: dict[str, str | None] = Field(default_factory=dict)
    venue_column: int | None = None
    exam_start_date: date | None = None
    exam_year: int | None = None


class ImportOptions(BaseModel):
    # None copies every faculty's timetable (copying from an earlier semester only).
    faculty_id: str | None = None
    item_type: Literal["lecture", "exam"]
    mode: Literal["replace", "add"] = "replace"
    sheet: str | None = None
    file_name: str | None = None
    skip_blocked: bool = False
    # Copy from this earlier semester instead of reading a file.
    source_semester_id: int | None = None
    # General Studies: place each lecture in every faculty's timetable, and each
    # exam in the faculties its row names.
    place_in_faculties: bool = False
    answers: ImportAnswers = Field(default_factory=ImportAnswers)
