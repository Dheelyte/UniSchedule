"""The exam-shift planner: which days exams can land on and how far each one moves."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time

import pytest

from modules.timetable.exam_shift import (
    ExamCalendar,
    ShiftError,
    plan_shift,
    select_exams,
    shifted_week,
)

UG_EXAM_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

# August 2026: Mon 10, Tue 11, Wed 12, Thu 13, Fri 14, Sat 15, Sun 16, Mon 17 ...
assert date(2026, 8, 13).strftime("%A") == "Thursday"
assert date(2026, 8, 16).strftime("%A") == "Sunday"


@dataclass
class Exam:
    id: int
    exam_date: date | None
    start_time: time = time(9, 0)
    end_time: time = time(12, 0)
    week: int | None = 1
    faculty_id: str | None = "ENG"


@dataclass
class Block:
    name: str
    date: date | None = None
    day_of_week: str | None = None
    start_time: time | None = None
    end_time: time | None = None
    applies_to: str = "BOTH"


def d(day: int) -> date:
    return date(2026, 8, day)


def calendar(*blocks: Block) -> ExamCalendar:
    return ExamCalendar(UG_EXAM_DAYS, blocks)


def moved(plan) -> dict[int, date]:
    return {m.item_id: m.new_date for m in plan.moves}


# --- Days that can hold exams -------------------------------------------------

def test_sundays_are_not_exam_days_for_ug():
    cal = calendar()
    assert cal.is_exam_day(d(15))  # Saturday
    assert not cal.is_exam_day(d(16))  # Sunday


def test_whole_day_blocks_close_the_day_but_time_blocks_do_not():
    cal = calendar(
        Block("Public holiday", date=d(12)),
        Block("Jumat", day_of_week="Friday", start_time=time(12), end_time=time(15)),
    )
    assert not cal.is_exam_day(d(12))
    assert cal.is_exam_day(d(14))  # Friday is only blocked at midday


def test_lecture_only_blocks_do_not_affect_exams():
    cal = calendar(Block("Sports day", date=d(12), applies_to="LECTURE_ONLY"))
    assert cal.is_exam_day(d(12))


def test_a_programme_with_no_exam_days_is_refused():
    with pytest.raises(ShiftError):
        ExamCalendar([], [])


# --- Shifting by exam days ------------------------------------------------------

def test_shifting_by_days_skips_sundays():
    plan = plan_shift([Exam(1, d(14)), Exam(2, d(15))], calendar(), mode="days", amount=1)
    assert moved(plan) == {1: d(15), 2: d(17)}  # Fri -> Sat, Sat -> Mon


def test_shifting_by_days_skips_holidays():
    plan = plan_shift([Exam(1, d(11))], calendar(Block("Holiday", date=d(12))), mode="days", amount=1)
    assert moved(plan) == {1: d(13)}


def test_bringing_exams_forward_skips_sundays_too():
    plan = plan_shift([Exam(1, d(17))], calendar(), mode="days", amount=-1)
    assert moved(plan) == {1: d(15)}  # Mon -> Sat


def test_an_exam_landing_in_a_partly_blocked_slot_moves_on_to_a_free_day():
    jumat = Block("Jumat", day_of_week="Friday", start_time=time(12), end_time=time(15))
    morning = Exam(1, d(13), start_time=time(9), end_time=time(12))
    midday = Exam(2, d(13), start_time=time(12), end_time=time(15))

    plan = plan_shift([morning, midday], calendar(jumat), mode="days", amount=1)

    assert moved(plan) == {1: d(14), 2: d(15)}  # The midday exam can't sit on Friday
    assert [m.item_id for m in plan.pushed] == [2]
    assert "Jumat" in plan.pushed[0].pushed_past


def test_order_and_spacing_are_kept_when_nothing_is_blocked():
    exams = [Exam(1, d(10)), Exam(2, d(11)), Exam(3, d(13))]
    plan = plan_shift(exams, calendar(), mode="days", amount=2)
    assert moved(plan) == {1: d(12), 2: d(13), 3: d(15)}


# --- Shifting by weeks -----------------------------------------------------------

def test_shifting_by_weeks_keeps_the_weekday():
    plan = plan_shift([Exam(1, d(10)), Exam(2, d(15))], calendar(), mode="weeks", amount=2)
    assert moved(plan) == {1: d(24), 2: d(29)}


def test_shifting_by_weeks_onto_a_holiday_moves_to_the_next_exam_day():
    plan = plan_shift([Exam(1, d(10))], calendar(Block("Holiday", date=d(24))), mode="weeks", amount=2)
    assert moved(plan) == {1: d(25)}


def test_shifting_weeks_earlier_onto_a_holiday_moves_earlier():
    plan = plan_shift([Exam(1, d(24))], calendar(Block("Holiday", date=d(10))), mode="weeks", amount=-2)
    assert moved(plan) == {1: date(2026, 8, 8)}  # Saturday before


# --- Moving to a new start date --------------------------------------------------

def test_new_start_date_moves_the_first_exam_there_and_keeps_the_spacing():
    exams = [Exam(1, d(10)), Exam(2, d(11)), Exam(3, d(15))]
    plan = plan_shift(exams, calendar(), mode="start_date", new_start_date=d(13))
    # 10 -> 13 is 3 exam days; 11 -> 14; 15 (Sat) + 3 exam days -> Wed 19
    assert moved(plan) == {1: d(13), 2: d(14), 3: d(19)}


def test_new_start_date_on_a_sunday_or_holiday_is_refused():
    with pytest.raises(ShiftError, match="not an exam day"):
        plan_shift([Exam(1, d(10))], calendar(), mode="start_date", new_start_date=d(16))
    with pytest.raises(ShiftError, match="Holiday"):
        plan_shift([Exam(1, d(10))], calendar(Block("Holiday", date=d(13))), mode="start_date", new_start_date=d(13))


def test_new_start_date_equal_to_the_first_exam_moves_nothing():
    plan = plan_shift([Exam(1, d(10)), Exam(2, d(12))], calendar(), mode="start_date", new_start_date=d(10))
    assert plan.moves == [] and plan.selected == 2


# --- Choosing which exams move -----------------------------------------------------

def test_only_the_chosen_faculties_and_date_section_move():
    exams = [
        Exam(1, d(10), faculty_id="ENG"),
        Exam(2, d(12), faculty_id="ENG"),
        Exam(3, d(12), faculty_id="LAW"),
        Exam(4, d(17), faculty_id="ENG"),
    ]
    plan = plan_shift(exams, calendar(), mode="days", amount=1, faculty_ids=["ENG"], from_date=d(11), to_date=d(15))
    assert moved(plan) == {2: d(13)}
    assert plan.selected == 1


def test_exams_without_a_date_are_counted_but_not_moved():
    chosen, undated = select_exams([Exam(1, d(10)), Exam(2, None)])
    assert [e.id for e in chosen] == [1] and undated == 1


def test_a_from_date_after_the_to_date_is_refused():
    with pytest.raises(ShiftError):
        select_exams([], from_date=d(20), to_date=d(10))


def test_a_zero_shift_is_refused():
    with pytest.raises(ShiftError):
        plan_shift([Exam(1, d(10))], calendar(), mode="days", amount=0)


# --- Week numbers and the summary ----------------------------------------------------

def test_week_numbers_follow_the_calendar_weeks_moved():
    assert shifted_week(1, d(14), d(17)) == 2  # Fri -> next Mon
    assert shifted_week(3, d(24), d(10)) == 1
    assert shifted_week(1, d(17), d(10)) == 1  # never below week 1
    assert shifted_week(None, d(10), d(17)) is None


def test_date_changes_are_grouped_for_the_preview():
    exams = [Exam(1, d(10)), Exam(2, d(10)), Exam(3, d(11))]
    plan = plan_shift(exams, calendar(), mode="days", amount=1)
    assert plan.date_changes() == [(d(10), d(11), 2), (d(11), d(12), 1)]
