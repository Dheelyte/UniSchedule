from fastapi import Depends, HTTPException

from modules.audit.service import AuditService
from modules.calendar.repository import CalendarRepository
from modules.signoff.models import DEFAULT_SIGNATORY_TITLE, TimetableSignoff
from modules.signoff.repository import SignoffRepository
from modules.signoff.schemas import (
    ExportSignoffResponse,
    SignoffResponse,
    SignoffUpdate,
    VerificationInfo,
    VerifyResponse,
)
from modules.timetable.repository import TimetableRepository

TIMETABLE_TYPES = ("lecture", "exam")


def _as_response(timetable_type: str, signoff: TimetableSignoff | None) -> SignoffResponse:
    if signoff is None:
        return SignoffResponse(
            timetable_type=timetable_type,
            signatory_name="",
            signatory_title=DEFAULT_SIGNATORY_TITLE,
            signature_image=None,
            stamp_image=None,
        )
    return SignoffResponse.model_validate(signoff)


class SignoffService:
    def __init__(
        self,
        repo: SignoffRepository = Depends(),
        cal_repo: CalendarRepository = Depends(),
        timetable_repo: TimetableRepository = Depends(),
        audit_service: AuditService = Depends(),
    ):
        self.repo = repo
        self.cal_repo = cal_repo
        self.timetable_repo = timetable_repo
        self.audit_service = audit_service

    # ---------- Settings (super admin) ----------

    async def list_signoffs(self, current_user: dict) -> list[SignoffResponse]:
        rows = {s.timetable_type: s for s in await self.repo.list_signoffs(realm_key=current_user["realm"])}
        return [_as_response(t, rows.get(t)) for t in TIMETABLE_TYPES]

    async def update_signoff(self, timetable_type: str, data: SignoffUpdate, current_user: dict) -> SignoffResponse:
        realm_key = current_user["realm"]
        signoff = await self.repo.get_signoff(timetable_type, realm_key=realm_key)
        if signoff is None:
            signoff = TimetableSignoff(
                realm_key=realm_key,
                timetable_type=timetable_type,
                signatory_name="",
                signatory_title=DEFAULT_SIGNATORY_TITLE,
            )

        changes = data.model_dump(exclude_unset=True)
        for field in ("signatory_name", "signatory_title"):
            if field in changes:
                changes[field] = (changes[field] or "").strip()
        if changes.get("signatory_title") == "":
            raise HTTPException(status_code=400, detail="The signatory's title can't be empty")
        for field, value in changes.items():
            setattr(signoff, field, value)
        sub = current_user.get("sub")
        signoff.updated_by = int(sub) if sub is not None else None
        signoff = await self.repo.save_signoff(signoff)

        # Images are logged as changed, never copied into the log.
        what = [
            {"signatory_name": "name", "signatory_title": "title",
             "signature_image": "signature", "stamp_image": "stamp"}[f]
            for f in changes
        ]
        await self.audit_service.log(
            current_user=current_user,
            action="timetable.signoff.update",
            entity_type="timetable_signoff",
            entity_id=f"{realm_key}:{timetable_type}",
            description=f"Updated the {timetable_type} timetable sign-off ({', '.join(what) or 'no changes'})",
            extra={
                "timetable_type": timetable_type,
                "changed": what,
                "signatory_name": signoff.signatory_name,
                "signatory_title": signoff.signatory_title,
            },
        )
        return _as_response(timetable_type, signoff)

    # ---------- Exports ----------

    async def export_signoff(self, semester_id: int, timetable_type: str, current_user: dict) -> ExportSignoffResponse:
        realm_key = current_user["realm"]
        if not await self.cal_repo.get_semester(semester_id, realm_key=realm_key):
            raise HTTPException(status_code=404, detail="Semester not found")
        lock = await self.timetable_repo.get_lock(semester_id, timetable_type, realm_key=realm_key)
        if not lock or not lock.is_locked:
            return ExportSignoffResponse(is_locked=False)

        # Timetables locked before verification existed get their code on first export.
        verification = await self.repo.issue_verification(
            semester_id, timetable_type,
            realm_key=realm_key, locked_at=lock.locked_at, locked_by_email=None,
        )
        signoff = _as_response(timetable_type, await self.repo.get_signoff(timetable_type, realm_key=realm_key))
        return ExportSignoffResponse(
            is_locked=True,
            signatory_name=signoff.signatory_name,
            signatory_title=signoff.signatory_title,
            signature_image=signoff.signature_image,
            stamp_image=signoff.stamp_image,
            verification=VerificationInfo(code=verification.code, locked_at=verification.locked_at),
        )

    # ---------- Public verification ----------

    async def verify(self, code: str) -> VerifyResponse:
        verification = await self.repo.get_verification_by_code(code.strip().upper())
        names = await self.repo.describe(verification) if verification else None
        if not verification or not names:
            raise HTTPException(status_code=404, detail="No FINAL timetable has this code")
        realm_name, session_name, semester_name = names

        status, superseded_at = "current", None
        if verification.reopened_at is not None:
            newer = await self.repo.next_issue_after(verification)
            status = "superseded" if newer else "reopened"
            superseded_at = newer.locked_at if newer else None
        return VerifyResponse(
            code=verification.code,
            realm_name=realm_name,
            session_name=session_name,
            semester_name=semester_name,
            timetable_type=verification.timetable_type,
            locked_at=verification.locked_at,
            status=status,
            reopened_at=verification.reopened_at,
            superseded_at=superseded_at,
        )
