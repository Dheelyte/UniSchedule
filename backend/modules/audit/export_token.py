"""The token that ties every read of an Activity Logs export to its logged request.

POST /audit/export validates the request, logs `activity_log.export`, and returns
this token. GET /audit/export/analysis and /audit/export/rows read only what it
names: the filters, the days they cover (fixed when the export was requested, so
"Today" doesn't move during a long job), the last entry id, the sections and the
format. They also need the same super admin's login, in the same portal.

It carries the export-ticket `typ`, so get_current_user refuses it as a login,
and its own `kind`, so a timetable export ticket can't stand in for it.
"""
from dataclasses import dataclass
from datetime import date, timedelta

from fastapi import HTTPException

from api.dependencies.auth import EXPORT_TICKET
from core.security import create_access_token, decode_access_token
from modules.audit.filters import AuditFilters, filters_to_query, parse_filters

KIND = "activity_analysis"
# Long enough for an in-tab job over hundreds of thousands of rows.
TOKEN_LIFETIME = timedelta(hours=1)
EXPIRED = "This export has expired. Export again."


@dataclass(frozen=True)
class ExportGrant:
    filters: AuditFilters
    first: date
    last: date
    max_id: int
    sections: tuple[str, ...]
    format: str


def issue_export_token(user: dict, grant: ExportGrant) -> str:
    return create_access_token(
        {
            "typ": EXPORT_TICKET,
            "kind": KIND,
            "sub": str(user["sub"]),
            "realm": user["realm"],
            "filters": filters_to_query(grant.filters),
            "first": grant.first.isoformat(),
            "last": grant.last.isoformat(),
            "max_id": grant.max_id,
            "sections": list(grant.sections),
            "format": grant.format,
        },
        expires_delta=TOKEN_LIFETIME,
    )


def read_export_token(token: str | None, user: dict) -> ExportGrant:
    """The export a token names, if it was issued to this user in this portal and hasn't expired."""
    payload = decode_access_token(token) if token else None
    if (
        not payload
        or payload.get("typ") != EXPORT_TICKET
        or payload.get("kind") != KIND
        or str(payload.get("sub")) != str(user.get("sub"))
        or payload.get("realm") != user.get("realm")
    ):
        raise HTTPException(status_code=401, detail=EXPIRED)
    try:
        return ExportGrant(
            filters=parse_filters(payload["filters"]),
            first=date.fromisoformat(payload["first"]),
            last=date.fromisoformat(payload["last"]),
            max_id=int(payload["max_id"]),
            sections=tuple(payload["sections"]),
            format=payload["format"],
        )
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail=EXPIRED)
