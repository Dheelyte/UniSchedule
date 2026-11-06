"""Reading the pieces of a faculty timetable cell: time ranges, day and week
headers, dates and course codes.

Faculties write these many ways (`8:00am - 9:30am`, `08-09`, `12-3pm`,
`DAY 1: MONDAY , 10 AUGUST`, `JIL 412/402`, `LAG` over `MET133`). Every parser
here returns None when it isn't sure, so the caller can ask instead of guessing.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, time

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = {
    m: i for i, m in enumerate(
        ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], start=1
    )
}
MONTHS["SPT"] = 9  # "SPTEMBER" turns up in real headers
# Hours earlier than this with no am/pm are afternoon: "2-4" means 14:00-16:00.
EARLIEST_HOUR = 7

# --- Time ranges ------------------------------------------------------------

_CLOCK = r"(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(am|pm|noon|a\.m\.|p\.m\.)?"
_RANGE = re.compile(rf"^\s*{_CLOCK}\s*(?:-|–|—|to)+\s*{_CLOCK}\s*$", re.I)


def _resolve_hour(hour: int, suffix: str | None) -> int:
    suffix = (suffix or "").lower().replace(".", "")
    if suffix == "noon":
        return 12
    if suffix == "pm" and hour < 12:
        return hour + 12
    if suffix == "am" and hour == 12:
        return 0
    return hour


def parse_time_range(text) -> tuple[time, time] | None:
    """`8:00am - 9:30am`, `08-09`, `8.00 - 9.00`, `12-3pm`, `9am-12 noon` -> (start, end)."""
    if not isinstance(text, str):
        return None
    match = _RANGE.match(text.replace("\n", " "))
    if not match:
        return None
    h1, m1, s1, h2, m2, s2 = match.groups()
    h1, h2 = int(h1), int(h2)
    if h1 > 23 or h2 > 23:
        return None

    end = _resolve_hour(h2, s2)
    if end < EARLIEST_HOUR:
        end += 12
    if s1 and s1.lower() != "am":
        start = _resolve_hour(h1, s1)
    else:
        # No usable suffix: take the reading that ends up just before the end time.
        candidates = [h1] + ([h1 + 12] if h1 < 12 else [])
        before = [c for c in candidates if c < end or (c == end and int(m1 or 0) < int(m2 or 0))]
        start = max(before) if before else h1
    if start < EARLIEST_HOUR:
        start += 12

    try:
        start_t, end_t = time(start, int(m1 or 0)), time(end, int(m2 or 0))
    except ValueError:
        return None
    return (start_t, end_t) if start_t < end_t else None


# --- Days, dates and weeks --------------------------------------------------

_DAY_WORD = re.compile(r"\b(MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]*\b")
_SPACED_DAY = re.compile(r"^\s*([A-Z])(\s+[A-Z]){4,8}\s*$")
_WEEK = re.compile(r"\bWEEK\s*(\d{1,2})\b", re.I)
_DATE_DM = re.compile(r"\b(\d{1,2})(?:ST|ND|RD|TH)?\s*(?:OF\s+)?([A-Z]{3,9})\b,?\s*(\d{4})?")
_DATE_MD = re.compile(r"\b([A-Z]{3,9})\s+(\d{1,2})(?:ST|ND|RD|TH)?\b,?\s*(\d{4})?")


@dataclass
class DayLabel:
    weekday: str                  # "Monday"
    date: date | None = None      # when the header carries one
    date_text: str | None = None  # the date as written, for questions about it
    year_missing: bool = False    # "10 AUGUST": the date needs a year from elsewhere


def _month(word: str) -> int | None:
    return MONTHS.get(word[:3]) if len(word) >= 3 else None


def _find_date(upper: str) -> tuple[int, int, int | None, str] | None:
    """(day, month, year or None, matched text) from the first date in the text."""
    for pattern, order in ((_DATE_DM, "dm"), (_DATE_MD, "md")):
        for m in pattern.finditer(upper):
            if order == "dm":
                day, month, year = int(m.group(1)), _month(m.group(2)), m.group(3)
            else:
                month, day, year = _month(m.group(1)), int(m.group(2)), m.group(3)
            if month and 1 <= day <= 31:
                return day, month, int(year) if year else None, m.group(0).strip(" ,")
    return None


def parse_day_label(text) -> DayLabel | None:
    """A cell that names a day: `MONDAY`, `M O N D A Y`, `DAY 2 -- TUESDAY- AUGUST 11TH, 2026`.

    Returns None for anything else, including course cells and long notes that
    merely mention a day.
    """
    if not isinstance(text, str):
        return None
    upper = " ".join(text.upper().split())
    if _SPACED_DAY.match(upper):
        upper = upper.replace(" ", "")
    if len(upper) > 60:
        return None
    words = _DAY_WORD.findall(upper)
    if len(words) != 1:
        return None
    weekday = next((d for d in WEEKDAYS if d.upper().startswith(words[0])), None)
    if not weekday:
        return None
    # Whatever else is in the cell must look like a day header, not a course.
    leftover = _DAY_WORD.sub("", upper)
    found = _find_date(leftover)
    if found:
        leftover = leftover.replace(found[3], "")
    leftover = re.sub(r"\bDAY\s*\d+\b|[\d\s,.:;()\-–—]|ST|ND|RD|TH|OF", "", leftover)
    if leftover:
        return None

    label = DayLabel(weekday=weekday)
    if found:
        day, month, year, raw = found
        label.date_text = raw
        if year:
            try:
                label.date = date(year, month, day)
            except ValueError:
                return label
        else:
            label.year_missing = True
            label.date = date(1900, month, day)  # placeholder: the year is filled in later
    return label


def parse_week_label(text) -> int | None:
    if not isinstance(text, str) or len(text) > 60:
        return None
    m = _WEEK.search(text)
    return int(m.group(1)) if m else None


# --- Course codes -----------------------------------------------------------

# LAG-PRM 211, UNILAG-POL312, ARC-CM122, ANA-CM-203, PCH 201B, CHM-CM 101.
_CODE = re.compile(
    r"\b(?:(UNILAG|LAG)\s*-?\s*)?([A-Z]{2,4})\s*(-?\s*CM\s*-?)?\s*-?\s*(\d{3})([A-Z])?(?![A-Z0-9])"
)
# Words that look like a code's letters in headings: "100 AND 400 Level".
_NOT_LETTERS = {"AND", "THE", "FOR", "ALL", "TO", "OF", "IN", "ON", "AT", "BY"}
# A bare number after a slash takes the code before it: "FBA 410/414".
_BARE = re.compile(r"\s*/\s*(\d{3})([A-Z])?(?![A-Z0-9])")  # used with .match(text, pos)
# A bracket left open runs to the end of its line: "MAS 423 (MCB 7\nMCM 216 (MCB 5".
_PAREN = re.compile(r"\(([^()\n]*)\)?")


@dataclass
class CellCodes:
    codes: list[str] = field(default_factory=list)  # as written, tidied: "LAG-PRM211", "FBA414"
    notes: list[str] = field(default_factory=list)  # bracketed text that was removed
    leftover: str = ""                               # text that isn't a code or a note


def code_key(code: str) -> str:
    """The form codes are compared in: no spaces, hyphens or slashes, upper case."""
    return re.sub(r"[\s\-/]", "", code).upper()


def extract_codes(text) -> CellCodes:
    result = CellCodes()
    if text is None:
        return result
    # A letter O typed for a zero inside a course number: "PHL 2O3".
    raw = re.sub(r"(?<=\b[A-Z]{3} \d)O(?=\d)|(?<=\b[A-Z]{3}\d)O(?=\d)", "0", str(text).upper())
    rest = _PAREN.sub(" ", raw)
    # "LAG" alone on a line belongs to the code on the next line.
    rest = re.sub(r"\b(UNILAG|LAG)\s*\n\s*", r"\1-", rest)
    result.codes, result.leftover = _scan(" ".join(rest.split()))
    # A bracket can hold another paper sat together with this one: "FRE164 (FRE188)".
    for note in (n.strip() for n in _PAREN.findall(raw)):
        codes, note_left = _scan(note)
        result.codes += codes
        if note_left:
            result.notes.append(note_left if codes else note)
    # Keep order, drop repeats ("ENG 102 / ENG 102").
    seen = set()
    result.codes = [c for c in result.codes if not (c in seen or seen.add(c))]
    return result


def _scan(text: str) -> tuple[list[str], str]:
    """The codes in one stretch of text, and the words left over."""
    codes = []
    pos = 0
    last = None
    leftover = []
    while pos < len(text):
        bare = _BARE.match(text, pos) if last else None
        if bare:
            prefix, letters, cm = last
            codes.append(f"{prefix}{letters}{cm}{bare.group(1)}{bare.group(2) or ''}")
            pos = bare.end()
            continue
        m = _CODE.search(text, pos)
        if not m:
            leftover.append(text[pos:])
            break
        if m.group(2) in _NOT_LETTERS:
            leftover.append(text[pos:m.end()])
            pos = m.end()
            continue
        leftover.append(text[pos:m.start()])
        prefix = f"{m.group(1)}-" if m.group(1) else ""
        cm = "-CM" if m.group(3) else ""
        letters = m.group(2)
        codes.append(f"{prefix}{letters}{cm}{m.group(4)}{m.group(5) or ''}")
        last = (prefix, letters, cm)
        pos = m.end()
    return codes, " ".join(re.sub(r"[/&;,+]|\bAND\b", " ", " ".join(leftover)).split())
