from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# A cleaned-up scan is well under this; the cap keeps rows (and every export) small.
MAX_IMAGE_CHARS = 700_000
_IMAGE_PREFIX = "data:image/png;base64,"


class SignoffResponse(BaseModel):
    timetable_type: Literal["lecture", "exam"]
    signatory_name: str
    signatory_title: str
    signature_image: str | None
    stamp_image: str | None
    updated_at: datetime | None = None
    model_config = ConfigDict(from_attributes=True)


class SignoffUpdate(BaseModel):
    """Fields left out are unchanged; an image set to null is removed."""
    signatory_name: str | None = Field(default=None, max_length=120)
    signatory_title: str | None = Field(default=None, max_length=120)
    signature_image: str | None = None
    stamp_image: str | None = None

    @field_validator("signature_image", "stamp_image")
    @classmethod
    def _png_data_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.startswith(_IMAGE_PREFIX):
            raise ValueError("must be a PNG image")
        if len(value) > MAX_IMAGE_CHARS:
            raise ValueError("image is too large; use a smaller scan")
        return value


class VerificationInfo(BaseModel):
    code: str
    locked_at: datetime


class ExportSignoffResponse(BaseModel):
    """What a PDF export prints. Only a locked (FINAL) timetable is signed."""
    is_locked: bool
    signatory_name: str | None = None
    signatory_title: str | None = None
    signature_image: str | None = None
    stamp_image: str | None = None
    verification: VerificationInfo | None = None


class VerifyResponse(BaseModel):
    """Public: what /verify/<code> shows. Never includes the signature or stamp."""
    code: str
    realm_name: str
    session_name: str
    semester_name: str
    timetable_type: Literal["lecture", "exam"]
    locked_at: datetime
    # current: still FINAL. reopened: unlocked since, may have changed.
    # superseded: reopened and locked again; a newer FINAL version exists.
    status: Literal["current", "reopened", "superseded"]
    reopened_at: datetime | None = None
    superseded_at: datetime | None = None
