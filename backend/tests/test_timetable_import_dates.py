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
