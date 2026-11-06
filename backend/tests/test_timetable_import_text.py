from datetime import date, time

import pytest

from modules.timetable_import.text import extract_codes, parse_day_label, parse_time_range, parse_week_label


@pytest.mark.parametrize("text,expected", [
    ("8:00am - 9:30am", ((8, 0), (9, 30))),
    ("9:30am - 11:00", ((9, 30), (11, 0))),
    ("12:30am - 2:00pm", ((12, 30), (14, 0))),
    ("08-09", ((8, 0), (9, 0))),
    ("13.00 - 14.00", ((13, 0), (14, 0))),
    ("4:00-6:00pm", ((16, 0), (18, 0))),
    ("9am-12 noon", ((9, 0), (12, 0))),
    ("12-3pm", ((12, 0), (15, 0))),
    ("10 - 12pm", ((10, 0), (12, 0))),
    ("2 - 4pm", ((14, 0), (16, 0))),
    ("8am–10am", ((8, 0), (10, 0))),
])
def test_time_ranges(text, expected):
    (h1, m1), (h2, m2) = expected
    assert parse_time_range(text) == (time(h1, m1), time(h2, m2))


@pytest.mark.parametrize("text", ["Venue/Time", "GEO101", None, "MONDAY"])
def test_not_time_ranges(text):
    assert parse_time_range(text) is None


@pytest.mark.parametrize("text,weekday,day,year_missing", [
    ("MONDAY", "Monday", None, False),
    ("M O N D A Y", "Monday", None, False),
    ("DAY 1: MONDAY , 10 AUGUST", "Monday", date(1900, 8, 10), True),
    ("DAY 1:  MONDAY- 31ST AUGUST 2026 ", "Monday", date(2026, 8, 31), False),
    ("DAY 2 -- TUESDAY- AUGUST 11TH, 2026", "Tuesday", date(2026, 8, 11), False),
    ("DAY 6: SATURDAY - 5TH SPTEMBER 2026", "Saturday", date(2026, 9, 5), False),
])
def test_day_labels(text, weekday, day, year_missing):
    label = parse_day_label(text)
    assert (label.weekday, label.date, label.year_missing) == (weekday, day, year_missing)


@pytest.mark.parametrize("text", ["JUMAT SERVICE", "MON PHA321", "GST 101", None])
def test_not_day_labels(text):
    assert parse_day_label(text) is None


def test_week_label():
    assert parse_week_label("WEEK 2") == 2
    assert parse_week_label("ENG 102") is None


@pytest.mark.parametrize("text,codes,notes,leftover", [
    ("JIL 412/402", ["JIL412", "JIL402"], [], ""),
    ("JIL 110/121/211", ["JIL110", "JIL121", "JIL211"], [], ""),
    ("ESM 323 & BLD5", ["ESM323"], [], "BLD5"),
    ("EAE114; ADE141", ["EAE114", "ADE141"], [], ""),
    ("LAG\nMET133", ["LAG-MET133"], [], ""),
    ("UNILAG-POL312", ["UNILAG-POL312"], [], ""),
    ("HSS 325 (250)", ["HSS325"], ["250"], ""),
    ("CHM-CM 101 (DLI)", ["CHM-CM101"], ["DLI"], ""),
    ("ANA-CM-203", ["ANA-CM203"], [], ""),
    ("PCH 201B/PHM 201B", ["PCH201B", "PHM201B"], [], ""),
    ("MTH-CM 101/FSC 101", ["MTH-CM101", "FSC101"], [], ""),
    ("ENG 102 / ENG 102", ["ENG102"], [], ""),
    ("MAS 423 (MCB 7\nMCM 216 (MCB 5", ["MAS423", "MCM216"], ["MCB 7", "MCB 5"], ""),
    ("PHL 2O3", ["PHL203"], [], ""),
    ("SPORTS", [], [], "SPORTS"),
])
def test_extract_codes(text, codes, notes, leftover):
    result = extract_codes(text)
    assert (result.codes, result.notes, result.leftover) == (codes, notes, leftover)


def test_codes_inside_brackets():
    result = extract_codes("FRE164 (FRE188) CBT")
    assert (result.codes, result.notes, result.leftover) == (["FRE164", "FRE188"], [], "CBT")
