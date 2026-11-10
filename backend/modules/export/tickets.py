"""Export tickets: how a signed-in user's export is built on the frontend server.

Login cookies belong to the API's domain, so the frontend server can't see who
is asking. The page asks the API for a ticket (with its cookie), hands it to the
frontend server, and the server reads the export bundle with it.

A ticket is a short-lived JWT naming the user (with their chosen realm and any
impersonation, exactly as their login does) and one semester and timetable
type. It is not a login: get_current_user refuses it. Reading the bundle with it
re-checks the account (resolve_user), so a disabled user's ticket stops working.
"""
from datetime import timedelta

from fastapi import HTTPException

from api.dependencies.auth import EXPORT_TICKET
from core.security import create_access_token, decode_access_token

TICKET_LIFETIME = timedelta(minutes=2)

# The login claims that decide who the user is and where they work.
_IDENTITY_CLAIMS = ("sub", "realm", "act_as_role", "act_as_faculty_id", "impersonator_id")


def issue_ticket(user: dict, semester_id: int, timetable_type: str) -> str:
    claims = {key: user[key] for key in _IDENTITY_CLAIMS if user.get(key) is not None}
    claims.update(typ=EXPORT_TICKET, semester_id=semester_id, timetable_type=timetable_type)
    return create_access_token(claims, expires_delta=TICKET_LIFETIME)


def read_ticket(ticket: str | None, semester_id: int, timetable_type: str) -> dict:
    """The ticket's claims, if it is a valid ticket for this semester and type."""
    payload = decode_access_token(ticket) if ticket else None
    if (
        not payload
        or payload.get("typ") != EXPORT_TICKET
        or payload.get("semester_id") != semester_id
        or payload.get("timetable_type") != timetable_type
    ):
        raise HTTPException(status_code=401, detail="The export link has expired. Export again.")
    return payload
