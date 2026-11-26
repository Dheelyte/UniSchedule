"""Planning a shift of the exam timetable (postponing or bringing exams forward).

Pure functions with no database access, so every rule here is unit-tested directly.
The service loads the exams and blocked slots, asks for a plan, and applies it.

Rules:
- An exam only ever lands on one of the realm's exam days (UG: Monday to Saturday,
  so Sundays are skipped) and never on a day blocked for exams all day (a holiday,
  or a weekday blocked with no time range).
- If an exam's own time overlaps a partly blocked slot on its new day (e.g. Friday
  12:00-15:00 Jumat), it moves on to the next exam day in the same direction where
  its time is free.
- Times, rooms and everything else stay as they are; only the date (and the week
  number that goes with it) change.
"""
from __future__ import annotations

import collections
from dataclasses import dataclass, field
from datetime import date, time, timedelta
from typing import Iterable, Literal, Protocol

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# How far the planner will walk looking for a usable day before giving up.
MAX_SEARCH_DAYS = 400

ShiftMode = Literal["days", "weeks", "start_date"]


class ExamLike(Protocol):
    id: int
    exam_date: date | None
    start_time: time
    end_time: time
    week: int | None
    faculty_id: str | None


class BlockedLike(Protocol):
    name: str
    date: date | None
    day_of_week: str | None
    start_time: time | None
    end_time: time | None
    applies_to: object


class ShiftError(ValueError):
    """The request can't be planned; the message is shown to the admin."""


@dataclass(frozen=True)
class Move:
    item_id: int
    old_date: date
    new_date: date
    old_week: int | None
    new_week: int | None
    # Set when a partly blocked slot pushed the exam past the day the shift gave it.
    pushed_past: str | None = None


@dataclass
class ShiftPlan:
    moves: list[Move] = field(default_factory=list)
    selected: int = 0
    undated: int = 0  # Old exams stored without a date can't be shifted.

    @property
    def pushed(self) -> list[Move]:
        return [m for m in self.moves if m.pushed_past]

    def date_changes(self) -> list[tuple[date, date, int]]:
        """(old date, new date, number of exams), in date order."""
        counts = collections.Counter((m.old_date, m.new_date) for m in self.moves)
        return sorted((old, new, n) for (old, new), n in counts.items())


def _applies_to_exams(slot: BlockedLike) -> bool:
    scope = getattr(slot, "applies_to", "BOTH")
    scope = getattr(scope, "value", scope)
    return str(scope) != "LECTURE_ONLY"


def _on_day(slot: BlockedLike, day: date) -> bool:
    if slot.date is not None:
        return slot.date == day
    return slot.day_of_week == WEEKDAY_NAMES[day.weekday()]


class ExamCalendar:
    """Which days exams may sit on, given the realm's exam days and the blocked slots."""

    def __init__(self, exam_days: Iterable[str], blocked: Iterable[BlockedLike]):
        self.exam_days = set(exam_days)
        self.blocked = [s for s in blocked if _applies_to_exams(s)]
        if not self.exam_days:
            raise ShiftError("This programme has no exam days set")

    def whole_day_block(self, day: date) -> BlockedLike | None:
        for slot in self.blocked:
            if _on_day(slot, day) and (slot.start_time is None or slot.end_time is None):
                return slot
        return None

    def is_exam_day(self, day: date) -> bool:
        return WEEKDAY_NAMES[day.weekday()] in self.exam_days and self.whole_day_block(day) is None

    def time_block(self, day: date, start: time, end: time) -> BlockedLike | None:
        """A partly blocked slot on `day` that overlaps start-end, if any."""
        for slot in self.blocked:
            if (
                _on_day(slot, day)
                and slot.start_time is not None
                and slot.end_time is not None
                and start < slot.end_time
                and end > slot.start_time
            ):
                return slot
        return None

    def next_exam_day(self, day: date, direction: int) -> date:
        """The nearest exam day strictly after (direction 1) or before (-1) `day`."""
        current = day
        for _ in range(MAX_SEARCH_DAYS):
            current += timedelta(days=direction)
            if self.is_exam_day(current):
                return current
        raise ShiftError("Couldn't find an exam day within a year of " + day.isoformat())

    def step(self, day: date, exam_days: int) -> date:
        """Move `exam_days` exam days later (positive) or earlier (negative)."""
        direction = 1 if exam_days > 0 else -1
        current = day
        for _ in range(abs(exam_days)):
            current = self.next_exam_day(current, direction)
        return current

    def exam_days_between(self, start: date, end: date) -> int:
        """Signed number of exam days from `start` to `end` (end counted, start not)."""
        if start == end:
            return 0
        direction = 1 if end > start else -1
        count, current = 0, start
        while current != end:
            current += timedelta(days=direction)
            if self.is_exam_day(current):
                count += 1
        return count * direction


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def shifted_week(week: int | None, old: date, new: date) -> int | None:
    """Keep the week number in step with the date: +1 for each calendar week moved."""
    if week is None:
        return None
    return max(1, week + (_monday(new) - _monday(old)).days // 7)


def select_exams(
    exams: Iterable[ExamLike],
    *,
    faculty_ids: list[str] | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> tuple[list[ExamLike], int]:
    """The dated exams the shift applies to, and how many matching exams have no date."""
    if from_date and to_date and from_date > to_date:
        raise ShiftError("The 'from' date is after the 'to' date")
    faculties = set(faculty_ids or [])
    chosen, undated = [], 0
    for exam in exams:
        if faculties and exam.faculty_id not in faculties:
            continue
        if exam.exam_date is None:
            undated += 1
            continue
        if from_date and exam.exam_date < from_date:
            continue
        if to_date and exam.exam_date > to_date:
            continue
        chosen.append(exam)
    return chosen, undated


def plan_shift(
    exams: Iterable[ExamLike],
    calendar: ExamCalendar,
    *,
    mode: ShiftMode,
    amount: int | None = None,
    new_start_date: date | None = None,
    faculty_ids: list[str] | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> ShiftPlan:
    chosen, undated = select_exams(exams, faculty_ids=faculty_ids, from_date=from_date, to_date=to_date)
    plan = ShiftPlan(selected=len(chosen), undated=undated)
    if not chosen:
        return plan

    if mode == "start_date":
        if new_start_date is None:
            raise ShiftError("Choose the new date for the first exam")
        if not calendar.is_exam_day(new_start_date):
            block = calendar.whole_day_block(new_start_date)
            reason = f"blocked ({block.name})" if block else "not an exam day"
            raise ShiftError(f"{new_start_date:%A %d %b %Y} is {reason}; choose another start date")
        first = min(e.exam_date for e in chosen)
        days = calendar.exam_days_between(first, new_start_date)
        if days == 0:
            return plan  # Already starts there.
        mode, amount = "days", days
    elif not amount:
        raise ShiftError("Enter how many days or weeks to move the exams")

    direction = 1 if amount > 0 else -1
    for exam in chosen:
        if mode == "days":
            target = calendar.step(exam.exam_date, amount)
        else:  # weeks: same weekday, unless that day can't hold exams
            target = exam.exam_date + timedelta(weeks=amount)
            if not calendar.is_exam_day(target):
                target = calendar.next_exam_day(target, direction)

        pushed_past = None
        for _ in range(MAX_SEARCH_DAYS):
            block = calendar.time_block(target, exam.start_time, exam.end_time)
            if block is None:
                break
            pushed_past = pushed_past or (
                f"{block.name} ({block.start_time:%H:%M}-{block.end_time:%H:%M} on {target:%a %d %b})"
            )
            target = calendar.next_exam_day(target, direction)
        else:
            raise ShiftError("Couldn't find a free day for an exam within a year")

        if target != exam.exam_date:
            plan.moves.append(Move(
                item_id=exam.id,
                old_date=exam.exam_date,
                new_date=target,
                old_week=exam.week,
                new_week=shifted_week(exam.week, exam.exam_date, target),
                pushed_past=pushed_past,
            ))
    return plan
