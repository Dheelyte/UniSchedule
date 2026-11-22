from datetime import datetime

from pydantic import BaseModel


class GrantEditorAccessRequest(BaseModel):
    # The Faculty Viewer who receives the editor access.
    user_id: int


class RetractEditorAccessRequest(BaseModel):
    # Who gets the access next: omitted (or the caller's own id) returns it to
    # the original editor; another Faculty Viewer's id redirects it to them.
    to_user_id: int | None = None


class StaffMember(BaseModel):
    id: int | None
    email: str


class HandoverResponse(BaseModel):
    id: int
    realm_key: str
    faculty_id: str
    faculty_name: str
    granted_by: StaffMember
    holder: StaffMember
    started_at: datetime


class EditorAccessStatus(BaseModel):
    """What the signed-in staff member may do with editor access."""
    # An original Faculty Editor, who may hand their access to a viewer.
    can_grant: bool
    # The access this person handed over, which only they may retract or redirect.
    granted: HandoverResponse | None
    # The access this person was given by someone else.
    received: HandoverResponse | None
    # Faculty Viewers who could receive the access (empty unless can_grant or granted).
    candidates: list[StaffMember]
