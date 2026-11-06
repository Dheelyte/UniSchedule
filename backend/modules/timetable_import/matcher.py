"""Matching what a sheet says to the realm's courses and rooms.

A code matches a course only when the two are the same apart from spacing and
hyphens: `LAG-MET133`, `MET133` and `MET-CM133` are three different courses.
Anything else is a question for the admin, with near misses offered as
suggestions. Rooms are matched more loosely, since the same hall is written
`RM 103`, `Room 103` and `ROOM 103 (MAX 145)`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from modules.timetable_import.text import code_key

_PREFIX = re.compile(r"^(UNILAG|LAG)")
_PARTS = re.compile(r"\s*(?:&|,|/|;|\n|\bAND\b)\s*", re.I)


@dataclass
class CourseRef:
    id: int
    code: str
    title: str


@dataclass
class RoomRef:
    id: int
    name: str
    capacity: int
    faculty_id: str | None
    is_active: bool | None


# --- Courses ----------------------------------------------------------------

class CourseIndex:
    def __init__(self, courses: list[CourseRef]):
        self.by_key: dict[str, CourseRef] = {}
        for c in courses:
            self.by_key.setdefault(code_key(c.code), c)
        self.by_id = {c.id: c for c in courses}

    def match(self, code: str) -> CourseRef | None:
        return self.by_key.get(code_key(code))

    def suggest(self, code: str, limit: int = 5) -> list[CourseRef]:
        """Near misses: another prefix, CM or not, a trailing letter, one letter off."""
        key = code_key(code)
        bare = _PREFIX.sub("", key)
        m = re.match(r"^([A-Z]+?)(CM)?(\d{3})([A-Z]?)$", bare)
        if not m:
            return []
        letters, _, number, _ = m.groups()
        wanted = [bare, f"LAG{bare}", f"UNILAG{bare}", f"{letters}{number}", f"{letters}CM{number}",
                  f"LAG{letters}{number}", f"UNILAG{letters}{number}"]
        found = [self.by_key[k] for k in dict.fromkeys(wanted) if k != key and k in self.by_key]
        for k, course in self.by_key.items():
            if len(found) >= limit:
                break
            other = re.match(r"^([A-Z]+?)(CM)?(\d{3})([A-Z]?)$", _PREFIX.sub("", k))
            if (other and other.group(3) == number and len(other.group(1)) == len(letters)
                    and sum(a != b for a, b in zip(other.group(1), letters)) == 1 and course not in found):
                found.append(course)
        return found[:limit]


# --- Rooms ------------------------------------------------------------------

# One spelling for each word faculties write several ways. Applied to both the
# sheet's venue and the platform's room names, so either side can use any form.
_ROOM_WORDS = [
    (r"\b(?:CLASS\s*ROOMS?|LECTURE\s*ROOMS?|ROOMS?|RMS?)\b", "RM"),
    (r"\bSTU?DI?O?S?\b|\bSTDO\b", "STUDIO"),
    (r"\bAUD(?:ITORIUM)?\b", "AUDITORIUM"),
    (r"\bFAC(?:ULTY)?\b", "FACULTY"),
    (r"\bLAB(?:ORATORY|ORATORIES|S)?\b", "LAB"),
    (r"\bLECTURE\s*THEATRE\b|\bLECTURE\s*THEATER\b|\bLT\b", "LT"),
    (r"\bBLOCK\b|\bBLK\b|\bBK\b", "BLK"),
    (r"\bG\s+F\b|\bGROUND\s+FLOOR\b|\bGRD\s+FLR\b", "GF"),
    (r"\bF\s+F\b|\bFIRST\s+FLOOR\b|\b1ST\s+FLOOR\b|\b1ST\s+FLR\b", "FF"),
    (r"\bS\s+F\b|\bSECOND\s+FLOOR\b|\b2ND\s+FLOOR\b|\b2ND\s+FLR\b", "SF"),
    (r"\bARCHITECTURE\b", "ARCH"),
    # "400 LEVEL", "400L", "LEVEL 400", "YEAR 4" and "YR4" are all the fourth year.
    (r"\b([1-7])00\s*(?:LEVEL|LVL|L)\b|\bLEVEL\s*([1-7])00\b|\b(?:YEAR|YR)\s*([1-7])\b",
     lambda m: f"YR{m.group(1) or m.group(2) or m.group(3)}"),
]
_ROMAN = {"I": "1", "II": "2", "III": "3", "IV": "4", "V": "5", "VI": "6", "VII": "7", "VIII": "8", "IX": "9", "X": "10"}


def room_key(name: str) -> str:
    """The form room names are compared in.

    `Room 1`, `Room 001`, `room0001`, `Rm 1`, `Classroom 1` -> RM1; `S003`, `S 3` -> S3; `URP STUDIO II`, `URP Studio 2` -> URPSTUDIO2;
    `400 LEVEL STUDIO`, `YR4 Studio` -> YR4STUDIO; `FAC AUD`, `Faculty Auditorium` -> FACULTYAUDITORIUM.
    """
    text = re.sub(r"\([^)]*\)?", " ", name.upper())
    text = re.sub(r"[^A-Z0-9]+", " ", text)
    # Split "RM1" and "STUDIO2" so the words and numbers below are seen on their own.
    text = re.sub(r"\b(RMS?|ROOMS?|YR|YEAR)(\d)", r"\1 \2", text)
    text = re.sub(r"\b(BLK|BK)([A-Z])\b", r"BLK \2", text)  # "BKA" is Block A
    for pattern, replacement in _ROOM_WORDS:
        text = re.sub(pattern, replacement, text)
    # "Room No. 1" and "Room Number 1" are Room 1.
    text = re.sub(r"\b(?:NO|NUMBER|NUM)\b(?=\s*\d)", " ", text)
    words = [_ROMAN.get(w, w) for w in text.split()]
    # Zeros in front of a number don't change the room: "Room 001", "S003", "G05" are Room 1, S3, G5.
    words = [re.sub(r"\d+", lambda m: str(int(m.group())), w) for w in words]
    key = "".join(words)
    return re.sub(r"^R(?=\d)", "RM", key)  # "R255" is RM255


class RoomIndex:
    def __init__(self, rooms: list[RoomRef], faculty_id: str | None):
        self.faculty_id = faculty_id
        self.by_key: dict[str, list[RoomRef]] = {}
        for r in rooms:
            self.by_key.setdefault(room_key(r.name), []).append(r)
        self.by_id = {r.id: r for r in rooms}

    def _best(self, rooms: list[RoomRef]) -> RoomRef:
        # Old copies of a room were left behind with no capacity; prefer the live one.
        # Then the faculty's own room, then a shared one, before another faculty's.
        return min(rooms, key=lambda r: (
            r.is_active is False, r.capacity <= 0,
            r.faculty_id != self.faculty_id, r.faculty_id is not None, r.id,
        ))

    def _live(self, rooms: list[RoomRef]) -> list[RoomRef]:
        return [r for r in rooms if r.is_active is not False and r.capacity > 0]

    def match_one(self, text: str) -> RoomRef | None:
        """The room this name means, or None when it names no room or could be several.

        Different buildings reuse names (`RM 001` in Social Sciences, `RM 1` in
        SPEASSECE). The faculty's own room wins; otherwise a name that fits more
        than one live room is asked about rather than guessed.
        """
        rooms = self.by_key.get(room_key(text))
        if not rooms:
            return None
        live = self._live(rooms)
        own = [r for r in live if r.faculty_id == self.faculty_id]
        if not own and len(live) > 1:
            return None
        return self._best(rooms)

    def same_name(self, text: str) -> list[RoomRef]:
        """The live rooms that share this name, when it could be more than one."""
        live = self._live(self.by_key.get(room_key(text), []))
        return sorted(live, key=lambda r: r.name) if len(live) > 1 else []

    def match(self, text: str) -> list[RoomRef] | None:
        """The rooms a venue cell names, or None if any part of it isn't a known room.

        `Room 1& 2` is Room 1 and Room 2; `Science (L101, L105)` is L101 and L105.
        """
        whole = self.match_one(text)
        if whole:
            return [whole]
        for parts in (_split_venue(text), _split_venue(" ".join(re.findall(r"\(([^)]*)\)?", text)))):
            if not parts or parts == [text]:
                continue
            rooms = [self.match_one(p) for p in parts]
            if rooms and all(rooms):
                return list({r.id: r for r in rooms}.values())
        return None

    def suggest(self, text: str, limit: int = 5) -> list[RoomRef]:
        """Rooms whose name contains this one, shares its number, or shares its words."""
        if (same := self.same_name(text)):
            return same
        key = room_key(text)
        if not key:
            return []
        digits = "".join(re.findall(r"\d+", key))
        words = _words(text)
        scored = []
        for k, rooms in self.by_key.items():
            best = self._best(rooms)
            shared = len(words & _words(best.name)) / max(len(words), 1)
            if key in k or k in key:
                rank = 0
            elif digits and digits == "".join(re.findall(r"\d+", k)):
                rank = 1
            elif shared >= 0.5:
                rank = 2
            else:
                continue
            scored.append(((rank, -shared, abs(len(k) - len(key)), best.capacity <= 0, best.id), best))
        return [r for _, r in sorted(scored, key=lambda s: s[0])[:limit]]


def _words(name: str) -> set[str]:
    return set(re.findall(r"[A-Z0-9]+", re.sub(r"\bROOMS?\b", "RM", name.upper())))


def _split_venue(text: str) -> list[str]:
    parts = [p.strip() for p in _PARTS.split(text) if p and p.strip()]
    # A bare number takes the words before the number in the part before it: "Room 1 & 2".
    out = []
    for p in parts:
        if out and re.fullmatch(r"\d+[A-Z]?", p, re.I):
            stem = re.match(r"^(.*?)\s*\d+[A-Z]?$", out[-1])
            if stem and stem.group(1):
                p = f"{stem.group(1)} {p}"
        out.append(p)
    return out


# --- Faculties --------------------------------------------------------------

@dataclass
class FacultyRef:
    id: str
    name: str


def faculty_key(name: str) -> str:
    """`Faculty of Communication and Media Studies`, `Communication & Media Studies` -> COMMUNICATIONMEDIASTUDIE."""
    text = re.sub(r"\([^)]*\)?", " ", name.upper())
    text = re.sub(r"\b(?:FACULTY|SCHOOL|COLLEGE|CENTRE|CENTER)\s+(?:OF|FOR)\b|\bTHE\b|\bAND\b|&", " ", text)
    words = re.findall(r"[A-Z]+", text)
    # "Sciences" and "Science" are the same faculty.
    return "".join(w[:-1] if len(w) > 3 and w.endswith("S") else w for w in words)


def _distance(a: str, b: str) -> int:
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


class FacultyIndex:
    def __init__(self, faculties: list[FacultyRef]):
        self.faculties = faculties
        # A faculty answers to its name and to the short form its id starts with ("SPEASSECE-7439").
        self.keys = [(f, {faculty_key(f.name), re.sub(r"[^A-Z]", "", f.id.split("-")[0].upper())}) for f in faculties]

    def match(self, text: str) -> FacultyRef | None:
        key = faculty_key(text)
        if not key:
            return None
        exact = [f for f, keys in self.keys if key in keys]
        if len(exact) == 1:
            return exact[0]
        # A letter or two off ("Enviromental", "SPESSCE"), when only one faculty is that close.
        close = [f for f, keys in self.keys if min(_distance(key, k) for k in keys) <= (2 if len(key) >= 6 else 0)]
        return close[0] if len(close) == 1 else None

    def suggest(self, text: str, limit: int = 4) -> list[FacultyRef]:
        key = faculty_key(text)
        words = set(re.findall(r"[A-Z]{3,}", text.upper())) - {"FACULTY", "AND", "THE"}
        scored = []
        for f, keys in self.keys:
            shared = len(words & set(re.findall(r"[A-Z]{3,}", f.name.upper())))
            scored.append((-shared, min(_distance(key, k) for k in keys), f.name, f))
        return [f for *_, f in sorted(scored, key=lambda s: s[:3])[:limit]]
