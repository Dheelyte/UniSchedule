import re
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
ALLOWED_SLOT_MINUTES = (5, 10, 15, 20, 30, 60)
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _minutes(value: str) -> int:
    match = _TIME_RE.match(value)
    if not match:
        raise ValueError(f"'{value}' is not a valid HH:MM time")
    return int(match.group(1)) * 60 + int(match.group(2))


def _validate_days(days: list[str]) -> list[str]:
    if not days:
        raise ValueError("at least one day is required")
    unknown = [d for d in days if d not in WEEKDAYS]
    if unknown:
        raise ValueError(f"unknown weekday(s): {', '.join(map(str, unknown))}")
    if len(set(days)) != len(days):
        raise ValueError("days must be unique")
    # Kept in Monday→Sunday order whatever order they were sent in.
    return sorted(days, key=WEEKDAYS.index)


class ExamSlot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1)
    start: str
    end: str

    @model_validator(mode="after")
    def _start_before_end(self):
        if _minutes(self.start) >= _minutes(self.end):
            raise ValueError(f"exam slot '{self.label}' must start before it ends")
        return self


class RealmConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lecture_days: list[str]
    exam_days: list[str]
    day_start: str
    day_end: str
    slot_minutes: int
    exam_slots: list[ExamSlot] = Field(min_length=1)
    levels: list[int] = Field(min_length=1)
    semester_names: list[str] = Field(min_length=1)
    # True: the API rejects days, times or steps outside the config.
    # False: values outside are only flagged in the UI.
    strict: bool

    @field_validator("lecture_days", "exam_days")
    @classmethod
    def _days(cls, v: list[str]) -> list[str]:
        return _validate_days(v)

    @field_validator("day_start", "day_end")
    @classmethod
    def _on_the_hour(cls, v: str) -> str:
        if _minutes(v) % 60 != 0:
            raise ValueError(f"'{v}' must be on the hour")
        return v

    @field_validator("slot_minutes")
    @classmethod
    def _slot_minutes(cls, v: int) -> int:
        if v not in ALLOWED_SLOT_MINUTES:
            raise ValueError(f"slot_minutes must be one of {', '.join(map(str, ALLOWED_SLOT_MINUTES))}")
        return v

    @field_validator("levels")
    @classmethod
    def _levels(cls, v: list[int]) -> list[int]:
        if any(level <= 0 for level in v):
            raise ValueError("levels must be positive")
        if any(a >= b for a, b in zip(v, v[1:])):
            raise ValueError("levels must be unique and ascending")
        return v

    @field_validator("semester_names")
    @classmethod
    def _semester_names(cls, v: list[str]) -> list[str]:
        names = [name.strip() for name in v]
        if any(not name for name in names):
            raise ValueError("semester names can't be blank")
        if len(set(names)) != len(names):
            raise ValueError("semester names must be unique")
        return names

    @model_validator(mode="after")
    def _window_and_exam_slots(self):
        day_start, day_end = _minutes(self.day_start), _minutes(self.day_end)
        if day_start >= day_end:
            raise ValueError("day_start must be before day_end")
        previous_end = None
        for slot in self.exam_slots:
            start, end = _minutes(slot.start), _minutes(slot.end)
            if start < day_start or end > day_end:
                raise ValueError(f"exam slot '{slot.label}' is outside the day window")
            if (start - day_start) % self.slot_minutes or (end - day_start) % self.slot_minutes:
                raise ValueError(f"exam slot '{slot.label}' is off the {self.slot_minutes}-minute grid")
            if previous_end is not None and start != previous_end:
                raise ValueError("exam slots must be sorted and contiguous, with no gaps or overlaps")
            previous_end = end
        return self


class RealmResponse(BaseModel):
    key: str
    name: str
    description: str | None
    is_live: bool
    sort_order: int
    config: RealmConfig

    model_config = ConfigDict(from_attributes=True)


class RealmUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    is_live: bool | None = None
    sort_order: int | None = None
    config: RealmConfig | None = None
