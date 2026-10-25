"""Turning a faculty timetable workbook into raw entries: which text sits in
which cell, on which day, at which time, next to which venue.

Nothing here touches the database. Course codes and venues are matched later,
and anything the reader can't place is reported so the admin can be asked.

Two sheet shapes are read:

* Grids. Rows of venues, columns of times. Days run down the sheet in blocks
  (a `MONDAY` row, then its rooms), across the top (exam sheets: `DAY 1: MONDAY`
  over three slot columns), or sit in the first cell of each row with the room
  in brackets inside the course cell.
* Lists. One session per row under a header naming Day, Time and Course columns,
  in a sheet or in a Word table (General Studies sends theirs as a memo). A
  Faculty column says which faculties sit that row.
"""
from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, time
from typing import BinaryIO

import openpyxl
from defusedxml import ElementTree

from modules.timetable_import.text import (
    DayLabel,
    extract_codes,
    parse_day_label,
    parse_time_range,
    parse_week_label,
)


@dataclass
class RawEntry:
    sheet: str
    row: int
    first_col: int
    last_col: int
    weekday: str
    start: time
    end: time
    text: str                                              # the cell as written
    codes: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)         # bracketed text: counts, rooms, "DLI"
    leftover: str = ""                                     # words that aren't codes: "SPORTS"
    venues: list[str] = field(default_factory=list)        # venue-column texts, left to right
    date: date | None = None
    date_text: str | None = None
    year_missing: bool = False
    week: int | None = None
    day_seq: int = 0                                       # which day header, in sheet order
    level: str | None = None                               # list sheets only
    faculties: list[str] = field(default_factory=list)     # list sheets with a Faculty column


@dataclass
class SheetResult:
    name: str
    shape: str                                             # "grid", "list" or "none"
    entries: list[RawEntry] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def course_count(self) -> int:
        return sum(len(e.codes) for e in self.entries)


# An .xlsx is a zip; a small upload can unpack to gigabytes. Real timetables
# unpack to a few MB (one carrying 65,000 empty formatted rows unpacks to 85 MB).
MAX_UNPACKED_BYTES = 150 * 1024 * 1024
MAX_PARTS = 2000


class WorkbookTooLarge(ValueError):
    pass


def _check_unpacked_size(source) -> None:
    with zipfile.ZipFile(source) as archive:
        parts = archive.infolist()
        if len(parts) > MAX_PARTS or sum(p.file_size for p in parts) > MAX_UNPACKED_BYTES:
            raise WorkbookTooLarge("The workbook unpacks to more than a timetable needs")
    if hasattr(source, "seek"):
        source.seek(0)


def read_workbook(source: str | BinaryIO) -> list[SheetResult]:
    """The timetables in an Excel workbook (.xlsx) or a Word document (.docx)."""
    _check_unpacked_size(source)
    with zipfile.ZipFile(source) as archive:
        is_word = "word/document.xml" in archive.namelist()
        document = archive.read("word/document.xml") if is_word else None
    if hasattr(source, "seek"):
        source.seek(0)
    if is_word:
        return [_read_table(name, cells, merge_of) for name, cells, merge_of in _word_tables(document)]
    # Not read_only: merged ranges are only available on full worksheets.
    workbook = openpyxl.load_workbook(source, data_only=True)
    return [read_sheet(ws) for ws in workbook.worksheets]


def read_sheet(ws) -> SheetResult:
    return _read_table(ws.title, *_sheet_cells(ws))


def _read_table(name, cells, merge_of) -> SheetResult:
    header = _list_header(cells)
    if header:
        return _read_list(name, cells, *header)
    result = _read_grid(name, cells, merge_of)
    if not result.entries:
        result.shape = "none"
    return result


# --- Word tables ------------------------------------------------------------

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _word_text(cell) -> str:
    paragraphs = []
    for p in cell.iter(f"{_W}p"):
        parts = []
        for node in p.iter():
            if node.tag == f"{_W}t" and node.text:
                parts.append(node.text)
            elif node.tag in (f"{_W}tab", f"{_W}br"):
                parts.append(" " if node.tag == f"{_W}tab" else "\n")
        paragraphs.append("".join(parts))
    return "\n".join(paragraphs).strip()


def _word_tables(document: bytes):
    """Each table in a Word document as (name, cells, merge_of), like a sheet's.

    A cell merged down a column (`vMerge`) carries the text of the cell it continues.
    """
    root = ElementTree.fromstring(document)
    for t, table in enumerate(root.iter(f"{_W}tbl"), start=1):
        cells: dict[tuple[int, int], str] = {}
        merge_of: dict[tuple[int, int], int] = {}
        for r, row in enumerate(table.findall(f"{_W}tr"), start=1):
            c = 1
            for cell in row.findall(f"{_W}tc"):
                props = cell.find(f"{_W}tcPr")
                span = props.find(f"{_W}gridSpan") if props is not None else None
                width = int(span.get(f"{_W}val", "1")) if span is not None else 1
                vmerge = props.find(f"{_W}vMerge") if props is not None else None
                if vmerge is not None and vmerge.get(f"{_W}val", "continue") == "continue" and (r - 1, c) in merge_of:
                    text, merge = cells.get((r - 1, c), ""), merge_of[(r - 1, c)]
                else:
                    text, merge = _word_text(cell), len(merge_of) + r * 1000 + c
                for k in range(width):
                    if text:
                        cells[(r, c + k)] = text
                    merge_of[(r, c + k)] = merge
                c += width
        yield f"Table {t}", cells, merge_of


# --- Cells ------------------------------------------------------------------

def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat() if value.time() == time() else value.isoformat(sep=" ")
    if isinstance(value, time):
        return value.strftime("%H:%M")
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _sheet_cells(ws) -> tuple[dict[tuple[int, int], str], dict[tuple[int, int], int]]:
    """Non-empty cells by (row, col), with merged ranges copied to every cell they cover.

    Reads `ws._cells` directly: some sheets report 16384 columns, and walking
    every empty cell of those takes far longer than reading the filled ones.
    """
    cells = {}
    for (r, c), cell in ws._cells.items():
        text = _text(cell.value)
        if text:
            cells[(r, c)] = text
    merge_of = {}
    for i, rng in enumerate(ws.merged_cells.ranges):
        text = cells.get((rng.min_row, rng.min_col), "")
        for r in range(rng.min_row, rng.max_row + 1):
            for c in range(rng.min_col, rng.max_col + 1):
                merge_of[(r, c)] = i
                if text:
                    cells[(r, c)] = text
    return cells, merge_of


def _rows(cells) -> dict[int, dict[int, str]]:
    rows: dict[int, dict[int, str]] = {}
    for (r, c), text in cells.items():
        rows.setdefault(r, {})[c] = text
    return {r: dict(sorted(cols.items())) for r, cols in sorted(rows.items())}


def _distinct(cols: dict[int, object], row: int, merge_of) -> int:
    """How many separate cells these columns are, counting a merged range once."""
    return len({merge_of.get((row, c), ("col", c)) for c in cols})


# --- Grids ------------------------------------------------------------------

def _read_grid(name, cells, merge_of) -> SheetResult:
    result = SheetResult(name=name, shape="grid")
    time_by_col: dict[int, tuple[time, time]] = {}
    day_by_col: dict[int, DayLabel] = {}   # days across the top
    block_day: DayLabel | None = None      # days down the sheet
    week: int | None = None
    unplaced = 0
    # Day headers numbered in the order they appear, so undated exam days can
    # be dated by walking on from one that has a date.
    seq_of: dict[int, int] = {}

    def numbered(labels):
        for label in labels:
            seq_of[id(label)] = len(seq_of)
        return labels

    for r, row in _rows(cells).items():
        times = {c: t for c, text in row.items() if (t := parse_time_range(text))}
        days = _leftmost_of_merges(
            {c: d for c, text in row.items() if (d := parse_day_label(text))}, r, merge_of,
        )
        row_week = next((w for text in row.values() if (w := parse_week_label(text))), None)

        if _distinct(times, r, merge_of) >= 2:
            time_by_col = _split_merged_times(times, r, merge_of)
            if len(days) == 1 and not day_by_col:
                block_day = numbered(list(days.values()))[0]
            continue

        if len(days) >= 2:
            day_by_col, block_day = days, None
            numbered(days.values())
            if row_week:
                week = row_week
            continue

        has_courses = any(extract_codes(row[c]).codes for c in row if c in time_by_col)
        row_day = None
        if len(days) == 1:
            if not has_courses:
                block_day, day_by_col = numbered(list(days.values()))[0], {}
                if row_week:
                    week = row_week
                continue
            # The day sits in the row's own first cell, next to the courses.
            row_day = numbered(list(days.values()))[0]

        if row_week and not has_courses:
            week = row_week
            continue
        if not time_by_col or not has_courses:
            continue

        first_time, last_time = min(time_by_col), max(time_by_col)
        venues = [
            text for c, text in row.items()
            if (c < first_time or c > last_time) and c not in days
            and not parse_time_range(text) and not parse_week_label(text)
        ]
        for first, last, text in _spans(row, time_by_col):
            day = row_day or _day_for(first, day_by_col) or block_day
            if not day:
                unplaced += 1
                continue
            codes = extract_codes(text)
            result.entries.append(RawEntry(
                sheet=name, row=r, first_col=first, last_col=last,
                weekday=day.weekday, date=day.date, date_text=day.date_text,
                year_missing=day.year_missing, week=week, day_seq=seq_of[id(day)],
                start=time_by_col[first][0], end=time_by_col[last][1],
                text=text, codes=codes.codes, notes=codes.notes, leftover=codes.leftover,
                venues=venues,
            ))

    if unplaced:
        result.warnings.append(f"{unplaced} cell(s) had courses but no day above them")
    return result


def _split_merged_times(times, row, merge_of) -> dict[int, tuple[time, time]]:
    """Share a merged time header out over the columns under it.

    `10 - 12pm` across two columns makes them 10-11 and 11-12, so two courses
    written side by side under it each get their hour. A course merged across
    both columns joins back into 10-12 in `_spans`.
    """
    groups: dict[object, list[int]] = {}
    for c in sorted(times):
        groups.setdefault(merge_of.get((row, c), ("col", c)), []).append(c)
    split = {}
    for cols in groups.values():
        start, end = times[cols[0]]
        minutes = (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)
        step, extra = divmod(minutes, len(cols))
        if extra:
            split.update({c: times[c] for c in cols})
            continue
        for i, c in enumerate(cols):
            a = start.hour * 60 + start.minute + i * step
            split[c] = (time(a // 60, a % 60), time((a + step) // 60, (a + step) % 60))
    return split


def _leftmost_of_merges(cols: dict, row: int, merge_of) -> dict:
    """One entry per merged range: a header merged over three columns counts once."""
    kept, seen = {}, set()
    for c in sorted(cols):
        key = merge_of.get((row, c), ("col", c))
        if key not in seen:
            seen.add(key)
            kept[c] = cols[c]
    return kept


def _day_for(col: int, day_by_col: dict[int, DayLabel]) -> DayLabel | None:
    """The day header at or nearest to the left of this column."""
    left = [c for c in day_by_col if c <= col]
    return day_by_col[max(left)] if left else None


def _spans(row: dict[int, str], time_by_col) -> list[tuple[int, int, str]]:
    """Runs of neighbouring time columns holding the same text, as (first, last, text).

    `ENG 102 | ENG 102` across 8-9 and 9-10 is one two-hour session. A run
    breaks where the times stop following on, so it never jumps a gap.
    """
    spans = []
    for c in sorted(time_by_col):
        text = row.get(c, "")
        if spans and text and spans[-1][2] == text and time_by_col[spans[-1][1]][1] == time_by_col[c][0]:
            spans[-1][1] = c
        elif text:
            spans.append([c, c, text])
    return [tuple(s) for s in spans]


# --- Lists ------------------------------------------------------------------

_HEADERS = {
    "day": re.compile(r"^day$"),
    "time": re.compile(r"^(time|period)$"),
    "start": re.compile(r"^(start|from)( time)?$"),
    "end": re.compile(r"^(end|to)( time)?$"),
    "prefix": re.compile(r"^prefix$"),
    "course": re.compile(r"^(?:\w+ )?course(?: code)?(?:\(s\)|s)?$|^code$"),  # "GST COURSE(S)"
    "faculty": re.compile(r"^facult(?:y|ies)$"),
    "venue": re.compile(r"^(venue|room|hall)$"),
    "level": re.compile(r"^level$"),
}


def _list_header(cells) -> tuple[int, dict[str, int]] | None:
    """The row naming a list's columns, if the sheet is a list. Only the top rows are checked."""
    for r, row in list(_rows(cells).items())[:10]:
        found = {}
        for c, text in row.items():
            for key, pattern in _HEADERS.items():
                if key not in found and pattern.match(text.strip().lower()):
                    found[key] = c
        if "day" in found and "course" in found and ("time" in found or "start" in found):
            return r, found
    return None


def _faculty_names(text: str) -> list[str]:
    """One faculty per line or comma: "Computing & Informatics\nSPESSCE\nArchitecture"."""
    return [n.strip(" ,;") for n in re.split(r"[\n,;]", text) if n.strip(" ,;")]


def _read_list(name, cells, header_row, cols) -> SheetResult:
    result = SheetResult(name=name, shape="list")
    skipped = 0
    day_seq: dict[tuple, int] = {}  # each day a row names, in order, for dating exams
    for r, row in _rows(cells).items():
        if r <= header_row:
            continue
        day = parse_day_label(row.get(cols["day"], ""))
        if "time" in cols:
            times = parse_time_range(row.get(cols["time"], ""))
        else:
            times = parse_time_range(f'{row.get(cols["start"], "")} - {row.get(cols.get("end"), "")}')
        text = row.get(cols["course"], "")
        if text and row.get(cols.get("prefix")):
            text = f'{row[cols["prefix"]]}-{text}'
        if not (day and times and text):
            if row:
                skipped += 1
            continue
        codes = extract_codes(text)
        venue = (row.get(cols["venue"]) or "").strip(" ,;") if "venue" in cols else None
        seq = day_seq.setdefault((day.weekday, day.date, day.date_text), len(day_seq))
        result.entries.append(RawEntry(
            sheet=name, row=r, first_col=cols["course"], last_col=cols["course"],
            weekday=day.weekday, date=day.date, date_text=day.date_text, year_missing=day.year_missing,
            day_seq=seq, start=times[0], end=times[1],
            text=text, codes=codes.codes, notes=codes.notes, leftover=codes.leftover,
            venues=[venue] if venue else [], level=row.get(cols["level"]) if "level" in cols else None,
            faculties=_faculty_names(row.get(cols["faculty"], "")) if "faculty" in cols else [],
        ))
    if skipped:
        result.warnings.append(f"{skipped} row(s) were missing a day, time or course")
    return result
