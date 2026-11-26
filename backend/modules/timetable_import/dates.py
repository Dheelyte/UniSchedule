"""Dating exam days.

Exam sheets often date only some of their day headers (`DAY 5: FRIDAY (AUGUST
22, 2025)`) or none (`DAY 1: MONDAY`), and some leave the year off. Headers
appear in calendar order, so each undated one is the next day after the one
before it that falls on its weekday. Walking on from any dated header dates the
rest; when none is dated the admin gives the first exam date.

The admin can also give a first exam date for a sheet that is dated. The dates
are then remapped: every day moves by the same whole number of weeks, so the first
exam lands in the week of the chosen date, on its own weekday, and the gaps
between days stay as the sheet has them.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from modules.timetable_import.text import WEEKDAYS


@dataclass
class DayHeader:
    seq: int
    weekday: str
    date: date | None = None
    year_missing: bool = False
    date_text: str | None = None


@dataclass
class Dating:
    dates: dict[int, date]          # seq -> date
    problems: list[str]
    needs_start_date: bool = False
    needs_year: bool = False
    dated_in_sheet: bool = False    # the sheet itself dates at least one day
    remapped: bool = False          # moved to start from the date the admin chose


def _next_on(weekday: str, after: date) -> date:
    gap = (WEEKDAYS.index(weekday) - after.weekday() - 1) % 7 + 1
    return after + timedelta(days=gap)


def _previous_on(weekday: str, before: date) -> date:
    gap = (before.weekday() - WEEKDAYS.index(weekday) - 1) % 7 + 1
    return before - timedelta(days=gap)


def _years_in_order(headers: list[DayHeader], first_year: int) -> dict[int, int]:
    """A year for each yearless dated header, starting at first_year and moving on a
    year whenever the month goes backwards (December, then January)."""
    years, year, last = {}, first_year, None
    for h in headers:
        if h.date and h.year_missing:
            if last and (h.date.month, h.date.day) < last:
                year += 1
            last = (h.date.month, h.date.day)
            years[h.seq] = year
    return years


def date_exam_days(headers: list[DayHeader], *, start_date: date | None = None, year: int | None = None) -> Dating:
    headers = sorted(headers, key=lambda h: h.seq)
    result = Dating(dates={}, problems=[])
    if not headers:
        return result
    result.dated_in_sheet = any(h.date for h in headers)

    if start_date is not None and result.dated_in_sheet:
        # Remap: date the sheet as written (any year will do), then move it to the chosen start.
        if year is None and any(h.year_missing for h in headers if h.date):
            # The sheet's own year is unknown: take the nearby one whose dates fall on the weekdays it names.
            def with_years(first_year):
                years = _years_in_order(headers, first_year)
                out = []
                for h in headers:
                    if h.seq not in years:
                        out.append(h)
                        continue
                    try:
                        out.append(DayHeader(h.seq, h.weekday, h.date.replace(year=years[h.seq]), False, h.date_text))
                    except ValueError:  # 29 February
                        return None
                return out

            candidates = [c for c in (with_years(y) for y in range(start_date.year - 3, start_date.year + 2)) if c]
            if candidates:
                headers = min(candidates, key=lambda hs: sum(
                    1 for h in hs if h.date and WEEKDAYS[h.date.weekday()] != h.weekday
                ))
        written = date_exam_days(headers, year=year)
        if not written.dates:
            return written
        first = min(written.dates.values())
        target = start_date if start_date.weekday() == first.weekday() else _next_on(WEEKDAYS[first.weekday()], start_date)
        shift = target - first
        result.dates = {seq: d + shift for seq, d in written.dates.items()}
        result.problems = written.problems
        result.remapped = True
        return result

    stated: dict[int, date] = {}
    for h in headers:
        if not h.date:
            continue
        if h.year_missing:
            if year is None:
                result.needs_year = True
                continue
            try:
                stated[h.seq] = h.date.replace(year=year)
            except ValueError:
                result.problems.append(f"'{h.date_text}' is not a date in {year}")
                continue
        else:
            stated[h.seq] = h.date
        if WEEKDAYS[stated[h.seq].weekday()] != h.weekday:
            result.problems.append(
                f"{h.weekday} {h.date_text or stated[h.seq].isoformat()} is a {WEEKDAYS[stated[h.seq].weekday()]}"
            )
    if result.needs_year:
        return result

    if not stated:
        if start_date is None:
            result.needs_start_date = True
            return result
        first = headers[0]
        anchor_date = start_date if WEEKDAYS[start_date.weekday()] == first.weekday else _next_on(first.weekday, start_date)
        stated[first.seq] = anchor_date

    # Walk out from the first stated date, taking each later stated date as written.
    index = {h.seq: i for i, h in enumerate(headers)}
    anchor = min(stated)
    result.dates[anchor] = stated[anchor]
    for h in headers[index[anchor] + 1:]:
        previous = result.dates[headers[index[h.seq] - 1].seq]
        result.dates[h.seq] = stated.get(h.seq) or _next_on(h.weekday, previous)
        if result.dates[h.seq] <= previous:
            result.problems.append(f"{h.weekday} {result.dates[h.seq]:%d %b %Y} comes before the day above it")
    for h in reversed(headers[:index[anchor]]):
        following = result.dates[headers[index[h.seq] + 1].seq]
        result.dates[h.seq] = _previous_on(h.weekday, following)
    return result
