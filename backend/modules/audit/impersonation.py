"""Impersonation sessions, paired from the log for the Activity Logs export.

The log records `auth.impersonate.start` (with the role and faculty acted as in
extra) and `auth.impersonate.stop`, but a session can also end without a stop:

- starting to act as another role mints a new token, so a new start ends the
  previous session ("Switched role");
- switching portal mints a plain token, so `auth.switch_realm` ends it
  ("Switched portal");
- logouts aren't logged and tokens last 24 hours, so a session nothing ends is
  flagged "No stop recorded".

pair_sessions() is pure, so it can be tested without a database. The caller
reads the events from 24 hours before the range to 24 hours after it, so
sessions that cross the range's edges (or midnight) still pair.
"""
from dataclasses import dataclass, field
from datetime import datetime

START = "auth.impersonate.start"
STOP = "auth.impersonate.stop"
SWITCH = "auth.switch_realm"
EVENTS = (START, STOP, SWITCH)

ENDED_BY_STOP = "Stopped"
ENDED_BY_NEW_START = "Switched role"
ENDED_BY_PORTAL_SWITCH = "Switched portal"


@dataclass(frozen=True)
class Event:
    id: int
    at: datetime
    action: str
    # Who: the account id when recorded, else the lower-cased email.
    who: str
    email: str | None
    acting_role: str | None = None
    acting_faculty_id: str | None = None


@dataclass
class Session:
    who: str
    email: str | None
    acting_role: str | None
    acting_faculty_id: str | None
    started_at: datetime
    start_id: int
    ended_at: datetime | None = None
    ended_by: str | None = None
    actions: dict[str, int] = field(default_factory=dict)

    @property
    def flagged(self) -> bool:
        """Nothing in the log ends it."""
        return self.ended_at is None

    @property
    def duration_minutes(self) -> float | None:
        if self.ended_at is None:
            return None
        return round((self.ended_at - self.started_at).total_seconds() / 60, 1)

    @property
    def action_count(self) -> int:
        return sum(self.actions.values())

    def covers(self, at: datetime) -> bool:
        return self.started_at <= at and (self.ended_at is None or at < self.ended_at)

    def overlaps(self, start: datetime | None, end: datetime | None) -> bool:
        """Whether any part of the session falls in [start, end)."""
        if end is not None and self.started_at >= end:
            return False
        if start is not None and self.ended_at is not None and self.ended_at <= start:
            return False
        return True


def pair_sessions(events: list[Event]) -> list[Session]:
    """Sessions in the order they started.

    A start opens a session (ending the same person's open one); a stop or a
    portal switch ends the open one. A stop with no open session is ignored:
    its start is before the events read.
    """
    open_by_who: dict[str, Session] = {}
    sessions: list[Session] = []
    for event in sorted(events, key=lambda e: (e.at, e.id)):
        current = open_by_who.get(event.who)
        if event.action == START:
            if current is not None:
                current.ended_at, current.ended_by = event.at, ENDED_BY_NEW_START
            session = Session(
                who=event.who,
                email=event.email,
                acting_role=event.acting_role,
                acting_faculty_id=event.acting_faculty_id,
                started_at=event.at,
                start_id=event.id,
            )
            sessions.append(session)
            open_by_who[event.who] = session
        elif event.action in (STOP, SWITCH) and current is not None:
            current.ended_at = event.at
            current.ended_by = ENDED_BY_STOP if event.action == STOP else ENDED_BY_PORTAL_SWITCH
            del open_by_who[event.who]
    return sessions


def attach_actions(sessions: list[Session], actions: list[tuple[str, datetime, str]]) -> None:
    """Count each impersonated action (who, when, action code) in the session that covers it."""
    by_who: dict[str, list[Session]] = {}
    for session in sessions:
        by_who.setdefault(session.who, []).append(session)
    for who, at, action in actions:
        for session in by_who.get(who, ()):
            if session.covers(at):
                session.actions[action] = session.actions.get(action, 0) + 1
                break
