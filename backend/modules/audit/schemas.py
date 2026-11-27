from datetime import date, datetime
from typing import Any, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field


class ActivityLogResponse(BaseModel):
    id: int
    user_id: int | None
    user_email: str | None
    user_role: str | None
    user_faculty_id: str | None
    action: str
    entity_type: str | None
    entity_id: str | None
    description: str
    extra: dict | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------- GET /audit/logs/options: the filter bar's choices ----------

class DayRange(BaseModel):
    """Lagos days, both inclusive."""
    start: date
    end: date


class OptionAction(BaseModel):
    code: str
    # The category key it is counted under (modules/audit/categories.py).
    category: str
    count: int


class OptionUser(BaseModel):
    email: str
    # No account has this address any more; its entries are still matched by email.
    deleted: bool


class OptionFaculty(BaseModel):
    id: str
    name: str


class OptionDepartment(BaseModel):
    id: int
    name: str
    faculty_id: str


class OptionSession(BaseModel):
    id: int
    name: str
    # When it became current, per the log; None when the log didn't record it.
    start: date | None


class ActivityLogOptions(BaseModel):
    """Only what the table already shows, plus the portal's faculties and departments."""
    timezone: str
    today: date
    # What each preset covers today. "session" is None when its start isn't recorded.
    presets: dict[str, DayRange | None]
    # The longest range an export may cover, ending today.
    last_12_months: DayRange
    first_entry_at: datetime | None
    session: OptionSession | None
    actions: list[OptionAction]
    users: list[OptionUser]
    roles: list[str]
    faculties: list[OptionFaculty]
    departments: list[OptionDepartment]


# ---------- The export (SUPER_ADMIN only) ----------

# Each analysis section a person can tick. "raw" is the Raw data sheet (always in
# an XLSX) or the PDF appendix (capped at 2,000 rows).
ExportSection = Literal[
    "summary",
    "categories",
    "users",
    "roles_portals",
    "over_time",
    "out_of_hours",
    "unusual",
    "impersonation",
    "sensitive",
    "handovers",
    "locks",
    "courses",
    "change_requests",
    "exports",
    "members",
    "raw",
]
EXPORT_SECTIONS: tuple[str, ...] = get_args(ExportSection)


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The page's filters under its URL names (modules/audit/filters.py).
    filters: dict[str, Any] = Field(default_factory=dict)
    format: Literal["xlsx", "pdf"]
    sections: list[ExportSection] = Field(min_length=1)
    # Applied by the renderer; recorded in the log entry.
    mask_emails: bool = False


class ExportPreview(BaseModel):
    """The live counts in the export modal."""
    first: date
    last: date
    # The range was shortened to the 12-month limit (the current-session preset only).
    clamped: bool
    events: int
    members: int
    invitations: int
    # False when the report only covers people who can't impersonate: the
    # Impersonation section is then left out.
    impersonation_applies: bool = True


class ExportStarted(ExportPreview):
    token: str
    file_name: str
    format: str
    sections: list[str]
    generated_by: str | None
    # Lagos time, e.g. 2026-11-26T14:05:03+01:00.
    generated_at: str
    timezone: str
    portal_key: str
    portal_name: str | None
    first_entry_at: str | None
    # The activity_log.export entry this export was recorded as: the report's
    # reference, so a file can be traced back to the log.
    reference: int | None = None
    # The last log entry id the export reads (later entries are left out).
    as_of_id: int | None = None
    # Printed on the report with a QR code; /verify/<code> confirms it's genuine.
    verification_code: str | None = None


class ReportVerifyResponse(BaseModel):
    """Public: what /verify/<code> shows for an activity log report. Enough to
    match a printed copy against the log, and nothing about who or what it covers."""
    document: Literal["activity_report"] = "activity_report"
    code: str
    reference: str
    realm_name: str
    first: date
    last: date
    generated_at: datetime
    events: int
    format: str


class ExportRowsPage(BaseModel):
    rows: list[dict[str, Any]]
    # Pass back as `after` for the next page; None on the last page.
    next: str | None
