"""Which timetable, lecture or exam, an activity log entry belongs to.

Actions record it in different places, so it is worked out per row in SQL:

    Actions                                           Where the type comes from
    ------------------------------------------------  ---------------------------------------------
    schedule_item.lecture.* / schedule_item.exam.*    the action code
      (incl. import, import_revert, import_approve)
    timetable.exam.shift                              the action code (always exam)
    timetable.lock / .unlock,                         extra.timetable_type
      timetable.signoff.update, change_request.create
    timetable.edit_request                            entity_id "<semester>:<type>"
    change_request.approve / .reject                  the change_requests row, else the request's
                                                      change_request.create entry
    blocked_slot.create / .update                     extra.applies_to (before and after on update)
    blocked_slot.delete (logged without extra)        the slot's latest earlier create/update entry
    conflict.dismiss                                  extra.item_a_id / item_b_id -> the schedule
                                                      item's type, else that item's own log entries
    conflict.restore                                  its conflict.dismiss entry (same entity_id),
                                                      then as above

A blocked slot that applies to BOTH timetables, or a change or conflict that
touches both, is "both" and matches either filter.

Everything else has no timetable type and only appears under "All":
conflict.dismiss.bulk (it logs only a department and a count), editor_access.*
(handovers are per faculty, not per timetable), every action with no timetable
(course.*, faculty.*, department.*, room.*, user.*, auth.*, calendar.*,
realm.update, activity_log.export), and any row whose lookup finds nothing.

Every subquery is correlated to the outer ActivityLog row, so these expressions
must be used in a query that selects FROM activity_logs (unaliased).
"""
from sqlalchemy import Integer, and_, case, cast, func, select
from sqlalchemy.orm import aliased

from modules.audit.models import ActivityLog
from modules.timetable.models import ChangeRequest, ScheduleItem

LECTURE = "lecture"
EXAM = "exam"
BOTH = "both"
TYPES = (LECTURE, EXAM)

# How blocked slots name the timetables they apply to (BlockedSlotCreate.applies_to).
_APPLIES_TO = {"LECTURE_ONLY": LECTURE, "EXAM_ONLY": EXAM, "BOTH": BOTH}

A = ActivityLog


def safe_int(text):
    """A text expression as an integer, or NULL when it isn't a plain number.

    Ids in old or odd rows are never trusted to cast cleanly.
    """
    return case((text.op("~")(r"^[0-9]{1,9}$"), cast(text, Integer)), else_=None)


def _combine(a, b):
    """One label for two: equal labels stay, a missing one defers to the other,
    and two different ones mean both timetables."""
    return case((a == b, a), (a.is_(None), b), (b.is_(None), a), else_=BOTH)


def _applies_to_label(value):
    return case(*((value == raw, label) for raw, label in _APPLIES_TO.items()), else_=None)


def _blocked_slot_type():
    earlier = aliased(ActivityLog)
    earlier_value = func.coalesce(earlier.extra["applies_to"].astext, earlier.extra[("after", "applies_to")].astext)
    # A deletion logs no details: use what the slot's latest earlier entry recorded.
    previous = (
        select(earlier_value)
        .where(
            earlier.entity_type == "blocked_slot",
            earlier.entity_id == A.entity_id,
            earlier.id != A.id,
            earlier.created_at <= A.created_at,
            earlier_value.isnot(None),
        )
        .order_by(earlier.created_at.desc(), earlier.id.desc())
        .limit(1)
        .correlate(A)
        .scalar_subquery()
    )
    after = func.coalesce(A.extra["applies_to"].astext, A.extra[("after", "applies_to")].astext, previous)
    before = A.extra[("before", "applies_to")].astext
    return _combine(_applies_to_label(before), _applies_to_label(after))


def _item_type(item_id_text):
    """A schedule item's type: from its row while it exists, else from its own latest log entry."""
    live = (
        select(ScheduleItem.type)
        .where(ScheduleItem.id == safe_int(item_id_text), ScheduleItem.type.in_(TYPES))
        .correlate(A)
        .scalar_subquery()
    )
    entry = aliased(ActivityLog)
    entry_type = func.split_part(entry.action, ".", 2)
    logged = (
        select(entry_type)
        .where(
            entry.entity_type == "schedule_item",
            entry.entity_id == item_id_text,
            entry.action.startswith("schedule_item.", autoescape=True),
            entry_type.in_(TYPES),
        )
        .order_by(entry.created_at.desc(), entry.id.desc())
        .limit(1)
        .correlate(A)
        .scalar_subquery()
    )
    return func.coalesce(live, logged)


def _restored_item_type(key: str):
    """For conflict.restore: the type of an item named by the matching conflict.dismiss entry.

    One level of subquery (joins, not nesting) keeps the correlation to the outer row.
    """
    dismissal = aliased(ActivityLog)
    item_id_text = dismissal.extra[key].astext
    dismissed = and_(
        dismissal.entity_type == "conflict_dismissal",
        dismissal.entity_id == A.entity_id,
        dismissal.action == "conflict.dismiss",
    )
    live = (
        select(ScheduleItem.type)
        .select_from(dismissal)
        .join(ScheduleItem, ScheduleItem.id == safe_int(item_id_text))
        .where(dismissed, ScheduleItem.type.in_(TYPES))
        .order_by(dismissal.created_at.desc())
        .limit(1)
        .correlate(A)
        .scalar_subquery()
    )
    entry = aliased(ActivityLog)
    entry_type = func.split_part(entry.action, ".", 2)
    logged = (
        select(entry_type)
        .select_from(dismissal)
        .join(entry, and_(entry.entity_type == "schedule_item", entry.entity_id == item_id_text))
        .where(dismissed, entry.action.startswith("schedule_item.", autoescape=True), entry_type.in_(TYPES))
        .order_by(dismissal.created_at.desc(), entry.created_at.desc(), entry.id.desc())
        .limit(1)
        .correlate(A)
        .scalar_subquery()
    )
    return func.coalesce(live, logged)


def _change_request_type():
    live = (
        select(ChangeRequest.timetable_type)
        .where(ChangeRequest.id == safe_int(A.entity_id), ChangeRequest.timetable_type.in_(TYPES))
        .correlate(A)
        .scalar_subquery()
    )
    created = aliased(ActivityLog)
    logged = (
        select(created.extra["timetable_type"].astext)
        .where(
            created.entity_type == "change_request",
            created.entity_id == A.entity_id,
            created.action == "change_request.create",
            created.extra["timetable_type"].astext.in_(TYPES),
        )
        .order_by(created.created_at.desc(), created.id.desc())
        .limit(1)
        .correlate(A)
        .scalar_subquery()
    )
    return func.coalesce(live, logged)


def timetable_type_expr():
    """'lecture', 'exam', 'both' or NULL for the outer activity_logs row (see the module docstring)."""
    extra_type = A.extra["timetable_type"].astext
    entity_type_suffix = func.split_part(A.entity_id, ":", 2)
    return case(
        (A.action.startswith("schedule_item.lecture.", autoescape=True), LECTURE),
        (A.action.startswith("schedule_item.exam.", autoescape=True), EXAM),
        (A.action.startswith("timetable.exam.", autoescape=True), EXAM),
        (extra_type.in_(TYPES), extra_type),
        (and_(A.entity_type == "timetable_lock", entity_type_suffix.in_(TYPES)), entity_type_suffix),
        (A.entity_type == "change_request", _change_request_type()),
        (A.action.startswith("blocked_slot.", autoescape=True), _blocked_slot_type()),
        (A.action == "conflict.dismiss", _combine(_item_type(A.extra["item_a_id"].astext), _item_type(A.extra["item_b_id"].astext))),
        (A.action == "conflict.restore", _combine(_restored_item_type("item_a_id"), _restored_item_type("item_b_id"))),
        else_=None,
    )


def matches_timetable_type(timetable_type: str):
    """The WHERE clause for a Lecture or Exam filter: that type, or both."""
    return timetable_type_expr().in_([timetable_type, BOTH])
