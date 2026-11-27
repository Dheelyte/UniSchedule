"""Reading a timetable grid out of a PDF that has real text in it.

Built for the PDFs this app exports (days across the top, time columns under
each day, a venue down the left, a box per course), and for any PDF laid out the
same way. PDFs hold positioned words and shapes, not cells, so the layout is
rebuilt from where they sit:

* a weekday word starts a day; the grid's vertical lines under it give its time
  columns, each named by the time range written in it ("8 - 10am");
* venue labels at the left give the rows, bounded by the grid's horizontal lines;
* each course box gives its course, and its left and right edges give the time
  it starts and ends. A class from 9 to 11 is drawn across the 8-10 and 10-12
  columns, so the column it is centred on is not its time. Without boxes, a
  course takes the time of the column it sits in.

The result is one list row per course (Day, Time, Course, Venue), read by the
list reader like any other sheet. Scanned PDFs have no text and are refused.
"""
from __future__ import annotations

import re
from typing import BinaryIO

from modules.timetable_import.text import WEEKDAYS, extract_codes, parse_time_range

MAX_PAGES = 60

_COURSE = re.compile(r"^[A-Z]+(?:-[A-Z]+)*\d{3}[A-Z]?$")
_WEEKDAY = {d.upper() for d in WEEKDAYS}
_TIME_RANGE = re.compile(
    r"\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)", re.I,
)
HEADER = ["Day", "Time", "Course", "Venue"]


class PdfWithoutText(ValueError):
    pass


def _lines(words, tolerance=3.0):
    """Words grouped into lines by their top edge, each line left to right."""
    lines: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(lines[-1][0]["top"] - w["top"]) <= tolerance:
            lines[-1].append(w)
        else:
            lines.append([w])
    return [sorted(line, key=lambda w: w["x0"]) for line in lines]


def _centre(o):
    return (o["x0"] + o["x1"]) / 2


def _middle(o):
    return (o["top"] + o["bottom"]) / 2


def _joined(words) -> str:
    """The words of one box as one text; a code broken over two lines ("PSY-" "CM101") is put back together."""
    text = ""
    for line in _lines(words):
        for w in line:
            piece = w["text"]
            text += piece if (not text or text.endswith("-") or piece.startswith("-")) else " " + piece
    return text


def _without_watermark(page):
    """The page without oversized letters: a DRAFT watermark across the grid would
    otherwise merge into the course codes under it ("DPRM417")."""
    sizes = sorted(c["size"] for c in page.chars)
    if not sizes:
        return page
    limit = sizes[len(sizes) // 2] * 3
    return page.filter(lambda o: o.get("object_type") != "char" or o.get("size", 0) <= limit)


def _clock(hours: float) -> str:
    """Hours after midnight, to the nearest quarter hour, as HH:MM."""
    minutes = round(hours * 4) * 15
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _page_rows(page) -> list[list[str]]:
    """One [day, time, course text, venue] per course on a page; [] if it holds no timetable."""
    words = page.extract_words(keep_blank_chars=False, use_text_flow=False)
    day_words = [w for w in words if w["text"].upper().strip(",") in _WEEKDAY]
    if not day_words:
        return []
    day_top = min(w["top"] for w in day_words)
    day_words = sorted((w for w in day_words if abs(w["top"] - day_top) <= 4), key=lambda w: w["x0"])

    if len(day_words) >= 2:
        # Several days across the top, each over its own columns.
        centres = [_centre(w) for w in day_words]
        spacing = (centres[-1] - centres[0]) / (len(centres) - 1)
        bounds = [centres[0] - spacing / 2] + [(a + b) / 2 for a, b in zip(centres, centres[1:])] + [centres[-1] + spacing / 2]
    else:
        # One day per page: its columns run from the venue column to the right edge of the grid.
        times = [w for w in words if day_top + 6 < w["top"] < day_top + 34 and re.match(r"^\d", w["text"])]
        if not times:
            return []
        first = min(w["x0"] for w in times)
        lines = sorted({round(e["x0"]) for e in page.edges if e["orientation"] == "v" and e["top"] <= day_top + 20})
        left = max((x for x in lines if x <= first), default=first - 4)
        right = max((x for x in lines if x > first), default=page.width)
        bounds, spacing = [left, right], right - left
    left_edge = bounds[0]

    def band_of(x):
        for i in range(len(day_words)):
            if bounds[i] <= x < bounds[i + 1]:
                return i
        return None

    # "MONDAY 25 JAN": the weekday and the short words after it on its line.
    labels = []
    for i, w in enumerate(day_words):
        rest = [
            x for x in words
            if abs(x["top"] - w["top"]) <= 4 and x["x0"] > w["x0"] and band_of(_centre(x)) == i
            and x["text"].upper().strip(",") not in _WEEKDAY
        ]
        labels.append(" ".join([w["text"]] + [x["text"] for x in sorted(rest, key=lambda x: x["x0"])]))

    # Time columns: between the grid's vertical lines under each day, named by the range written there.
    header_words = [w for w in words if day_top + 6 < w["top"] < day_top + 34 and w["x0"] >= left_edge - 1]
    v_lines = sorted({round(e["x0"]) for e in page.edges
                      if e["orientation"] == "v" and e["top"] <= day_top + 20 and e["bottom"] >= day_top + 24})
    # Every long vertical rule, including ones that only start under the header row (the
    # line on a day's outer edge can).
    long_lines = sorted({round(e["x0"]) for e in page.edges if e["orientation"] == "v" and e["bottom"] - e["top"] >= 30})
    slots: list[list[tuple[float, float, float, float]]] = []  # per day: (x0, x1, start hour, end hour)
    for i in range(len(day_words)):
        in_band = [w for w in header_words if band_of(_centre(w)) == i]
        edges = [x for x in v_lines if bounds[i] - 4 <= x <= bounds[i + 1] + 4]
        if in_band:
            first, last = min(w["x0"] for w in in_band), max(w["x1"] for w in in_band)
            if not edges or edges[0] > first:
                edges.insert(0, max((x for x in long_lines if x <= first), default=bounds[i]))
            if edges[-1] < last:
                edges.append(min((x for x in long_lines if x >= last), default=bounds[i + 1]))
        columns = list(zip(edges, edges[1:])) if len(edges) >= 2 else []
        day_slots = []
        for a, b in columns:
            text = " ".join(w["text"] for w in sorted(
                (w for w in in_band if a <= _centre(w) < b), key=lambda w: (round(w["top"] / 4), w["x0"])))
            if (t := parse_time_range(text)):
                day_slots.append((a, b, t[0].hour + t[0].minute / 60, t[1].hour + t[1].minute / 60))
        if not day_slots:
            # No grid lines: the ranges written under the day share it equally.
            text = " ".join(w["text"] for w in sorted(in_band, key=lambda w: (round(w["top"] / 4), w["x0"])))
            times = [t for m in _TIME_RANGE.finditer(text) if (t := parse_time_range(m.group(0)))]
            width = (bounds[i + 1] - bounds[i]) / max(len(times), 1)
            day_slots = [
                (bounds[i] + k * width, bounds[i] + (k + 1) * width,
                 t[0].hour + t[0].minute / 60, t[1].hour + t[1].minute / 60)
                for k, t in enumerate(times)
            ]
        slots.append(day_slots)
    if not any(slots):
        return []

    def hour_at(day, x):
        """The time at x across a day's columns, reading each column as its own range."""
        cols = slots[day]
        x = min(max(x, cols[0][0]), cols[-1][1])
        for a, b, start, end in cols:
            if a <= x <= b:
                return start + (x - a) / (b - a) * (end - start)
        return cols[-1][3]

    body_top = day_top + 34
    venue_words = [w for w in words if w["top"] >= body_top - 4 and w["x0"] < left_edge]
    groups: list[list[list[dict]]] = []
    for line in _lines(venue_words):
        # Lines of one wrapped venue label sit close together; rows are far apart.
        if groups and line[0]["top"] - groups[-1][-1][0]["top"] < 18:
            groups[-1].append(line)
        else:
            groups.append([line])
    row_names = [" ".join(w["text"] for line in g for w in line) for g in groups]
    row_centres = [sum(line[0]["top"] for line in g) / len(g) for g in groups]
    if not row_names:
        return []
    separators = sorted({round(e["top"]) for e in page.edges
                         if e["orientation"] == "h" and e["x0"] < left_edge and e["x1"] - e["x0"] > 40})

    def row_of(y):
        """The row at height y: the one whose label shares its band between two grid rules,
        else the nearest label (a tall row's top course is nearer the label above it)."""
        for a, b in zip(separators, separators[1:]):
            if a <= y < b:
                inside = [r for r, c in enumerate(row_centres) if a <= c + 4 < b]
                if inside:
                    return inside[0]
                break
        return min(range(len(row_centres)), key=lambda r: abs(row_centres[r] + 6 - y))

    # Course boxes: small filled shapes in the grid holding a course code.
    shapes = [
        s for s in page.curves + page.rects
        if s["top"] >= body_top - 4 and s["x0"] >= left_edge - 2 and 8 < s["bottom"] - s["top"] < 40
        and band_of(_centre(s)) is not None and s["x1"] - s["x0"] < spacing * 1.5
    ]

    def holds(outer, inner):
        return outer is not inner and outer["x0"] <= inner["x0"] + 1 and inner["x1"] <= outer["x1"] + 1 \
            and outer["top"] <= inner["top"] + 1 and inner["bottom"] <= outer["bottom"] + 1 \
            and (outer["x1"] - outer["x0"]) > (inner["x1"] - inner["x0"]) + 2

    # A row's shaded background is a shape too; only the innermost shapes are course boxes.
    shapes = [s for s in shapes if not any(holds(s, t) for t in shapes)]
    body = [w for w in words if w["top"] >= body_top - 4 and w["x0"] >= left_edge - 1]
    used: set[int] = set()
    out: list[list[str]] = []
    for s in sorted(shapes, key=lambda s: (s["top"], s["x0"])):
        inside = [w for w in body if id(w) not in used
                  and s["x0"] <= _centre(w) <= s["x1"] and s["top"] <= _middle(w) <= s["bottom"]]
        text = _joined(inside)
        if not inside or not extract_codes(text).codes:
            continue
        used.update(id(w) for w in inside)
        day = band_of(_centre(s))
        if not slots[day]:
            continue
        start, end = _clock(hour_at(day, s["x0"])), _clock(hour_at(day, s["x1"]))
        if start >= end:
            continue
        out.append([labels[day], f"{start} - {end}", text, row_names[row_of(_middle(s))]])

    # Courses not drawn in a box take the time of the column they sit in.
    for w in body:
        if id(w) in used or not _COURSE.match(w["text"].strip(",;")):
            continue
        day = band_of(_centre(w))
        col = next((c for c in (slots[day] if day is not None else []) if c[0] <= _centre(w) < c[1]), None)
        if col is None:
            continue
        out.append([labels[day], f"{_clock(col[2])} - {_clock(col[3])}", w["text"].strip(",;"), row_names[row_of(_middle(w))]])
    return out


def read_pdf_cells(source: str | BinaryIO):
    """(cells, merge_of) for the whole PDF: a list with a header row and one row per course."""
    cells: dict[tuple[int, int], str] = {(1, c): h for c, h in enumerate(HEADER, start=1)}
    row = 2
    any_text = False
    # Imported here, not at the top: pdfplumber adds about 9 MB, and the app is
    # loaded on every Lambda request, while only a PDF import needs it.
    import pdfplumber

    with pdfplumber.open(source) as pdf:
        if len(pdf.pages) > MAX_PAGES:
            raise ValueError("The PDF has too many pages")
        for page in pdf.pages:
            any_text = any_text or bool(page.chars)
            for values in _page_rows(_without_watermark(page)):
                for c, value in enumerate(values, start=1):
                    if value:
                        cells[(row, c)] = value
                row += 1
    if not any_text:
        raise PdfWithoutText("This PDF has no text to read (is it a scan?)")
    return cells, {}
