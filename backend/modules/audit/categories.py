"""The action categories of the Activity Logs page and its export.

A category is an action-code prefix. "Schedule items (all)" contains "Lecture
timetable" and "Exam timetable": choosing it replaces them, and each action is
counted under one category only (the one with the longest matching prefix), so
nothing is counted twice.

Mirrors CATEGORIES in src/app/activity/categories.js.
"""
from dataclasses import dataclass

from sqlalchemy import case


@dataclass(frozen=True)
class Category:
    key: str
    label: str
    prefix: str
    # Set on a category that a broader one contains.
    parent: str | None = None


CATEGORIES: tuple[Category, ...] = (
    Category("course", "Courses", "course."),
    Category("schedule_item", "Schedule items (all)", "schedule_item."),
    Category("schedule_item.lecture", "Lecture timetable", "schedule_item.lecture.", parent="schedule_item"),
    Category("schedule_item.exam", "Exam timetable", "schedule_item.exam.", parent="schedule_item"),
    Category("timetable", "Timetable locks / requests", "timetable."),
    Category("change_request", "Change requests", "change_request."),
    Category("blocked_slot", "Blocked slots", "blocked_slot."),
    Category("calendar", "Academic sessions", "calendar."),
    Category("faculty", "Faculties", "faculty."),
    Category("department", "Departments", "department."),
    Category("room", "Rooms", "room."),
    Category("user", "Users / invitations", "user."),
    Category("editor_access", "Editor access handovers", "editor_access."),
    Category("auth", "Auth", "auth."),
    Category("conflict", "Conflicts", "conflict."),
    Category("realm", "Portal settings", "realm."),
    Category("activity_log", "Exports", "activity_log."),
)

BY_KEY: dict[str, Category] = {c.key: c for c in CATEGORIES}

# For an action code no category covers.
OTHER = Category("other", "Other", "")

# Longest prefix first, so the first match is the most specific category.
_BY_SPECIFICITY = sorted(CATEGORIES, key=lambda c: len(c.prefix), reverse=True)


def normalize(keys) -> tuple[str, ...]:
    """The chosen category keys in display order, with a parent replacing its children.

    Raises ValueError on an unknown key.
    """
    chosen = set(keys)
    for key in chosen:
        if key not in BY_KEY:
            raise ValueError(f"Unknown category: {key}")
    return tuple(c.key for c in CATEGORIES if c.key in chosen and not (c.parent and c.parent in chosen))


def prefixes(keys) -> list[str]:
    """The action-code prefixes the chosen categories match (none: every action)."""
    return [BY_KEY[key].prefix for key in normalize(keys)]


def category_of(action: str) -> Category:
    """The one category an action is counted under."""
    for category in _BY_SPECIFICITY:
        if action.startswith(category.prefix):
            return category
    return OTHER


def category_expr(action_column):
    """SQL form of category_of: the key of the one category an action is counted under."""
    return case(
        *((action_column.startswith(c.prefix, autoescape=True), c.key) for c in _BY_SPECIFICITY),
        else_=OTHER.key,
    )


def label_of(key: str) -> str:
    return BY_KEY[key].label if key in BY_KEY else OTHER.label
