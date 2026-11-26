from datetime import date

from modules.timetable_import.dates import DayHeader, date_exam_days


def _week(*weekdays):
    return [DayHeader(seq=i, weekday=d) for i, d in enumerate(weekdays)]


def test_undated_days_are_dated_from_one_that_has_a_date():
    # Faculty of Arts: only DAY 5 and DAY 13 carry a date.
    headers = _week("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
                    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Monday")
    headers[4].date = date(2025, 8, 22)
    headers[12].date = date(2025, 9, 1)
    result = date_exam_days(headers)
    assert result.problems == []
    assert result.dates[0] == date(2025, 8, 18)
    assert result.dates[6] == date(2025, 8, 25)
    assert result.dates[12] == date(2025, 9, 1)


def test_no_dates_asks_for_the_first_exam_date():
    headers = _week("Monday", "Tuesday", "Monday")
    assert date_exam_days(headers).needs_start_date
    result = date_exam_days(headers, start_date=date(2026, 8, 10))
    assert [result.dates[i] for i in range(3)] == [date(2026, 8, 10), date(2026, 8, 11), date(2026, 8, 17)]


def test_missing_year_is_asked_for():
    headers = [DayHeader(seq=0, weekday="Monday", date=date(1900, 8, 10), year_missing=True, date_text="10 AUGUST")]
    assert date_exam_days(headers).needs_year
    assert date_exam_days(headers, year=2026).dates == {0: date(2026, 8, 10)}


def test_a_date_on_the_wrong_weekday_is_reported():
    headers = [DayHeader(seq=0, weekday="Monday", date=date(2026, 8, 11), date_text="11 AUGUST 2026")]
    assert date_exam_days(headers).problems == ["Monday 11 AUGUST 2026 is a Tuesday"]


def test_a_dated_sheet_is_remapped_to_a_chosen_first_date_keeping_its_gaps():
    # Mon 25 Jan, Tue 26 Jan, then a week off, then Mon 8 Feb.
    headers = [
        DayHeader(0, "Monday", date(2027, 1, 25)),
        DayHeader(1, "Tuesday", date(2027, 1, 26)),
        DayHeader(2, "Monday", date(2027, 2, 8)),
    ]
    plain = date_exam_days(headers)
    assert plain.dated_in_sheet and not plain.remapped
    result = date_exam_days(headers, start_date=date(2027, 3, 1))  # a Monday
    assert result.remapped
    assert result.dates == {0: date(2027, 3, 1), 1: date(2027, 3, 2), 2: date(2027, 3, 15)}


def test_a_chosen_date_on_another_weekday_starts_the_week_after_on_the_first_exams_weekday():
    headers = [DayHeader(0, "Wednesday", date(2027, 1, 27)), DayHeader(1, "Thursday", date(2027, 1, 28))]
    result = date_exam_days(headers, start_date=date(2027, 3, 1))  # a Monday
    assert result.dates == {0: date(2027, 3, 3), 1: date(2027, 3, 4)}


def test_remapping_a_sheet_without_years_needs_no_year_and_crosses_new_year():
    headers = [
        DayHeader(0, "Monday", date(1900, 12, 28), year_missing=True, date_text="28 DEC"),
        DayHeader(1, "Monday", date(1900, 1, 4), year_missing=True, date_text="4 JAN"),
    ]
    assert date_exam_days(headers).needs_year
    result = date_exam_days(headers, start_date=date(2026, 12, 7))  # a Monday
    assert not result.needs_year
    assert result.dates == {0: date(2026, 12, 7), 1: date(2026, 12, 14)}


def test_remapping_without_years_takes_the_year_whose_weekdays_fit():
    # 25 JAN is a Monday in 2027, not in 2026 (the chosen date's year).
    headers = [
        DayHeader(0, "Monday", date(1900, 1, 25), year_missing=True, date_text="25 JAN"),
        DayHeader(1, "Tuesday", date(1900, 1, 26), year_missing=True, date_text="26 JAN"),
    ]
    result = date_exam_days(headers, start_date=date(2026, 11, 30))  # a Monday
    assert result.problems == []
    assert result.dates == {0: date(2026, 11, 30), 1: date(2026, 12, 1)}
