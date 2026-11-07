import secrets
from datetime import datetime, timezone

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from modules.calendar.models import AcademicSession, Semester
from modules.realms.models import Realm
from modules.signoff.models import TimetableSignoff, TimetableVerification

# Letters and digits that can't be misread on paper (no 0/O, 1/I/L).
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def new_verification_code(realm_key: str) -> str:
    """e.g. UG-7K3P-92QD: the realm, then 8 random characters (~40 bits)."""
    part = lambda: "".join(secrets.choice(_CODE_ALPHABET) for _ in range(4))  # noqa: E731
    return f"{realm_key}-{part()}-{part()}"


class SignoffRepository:
    """Sign-offs and verifications are realm-scoped: every read takes the realm,
    except looking a verification up by its code, which is public by design."""

    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    # ---------- Signatories ----------

    async def list_signoffs(self, *, realm_key: str) -> list[TimetableSignoff]:
        result = await self.db.execute(
            select(TimetableSignoff).where(TimetableSignoff.realm_key == realm_key)
        )
        return list(result.scalars().all())

    async def get_signoff(self, timetable_type: str, *, realm_key: str) -> TimetableSignoff | None:
        result = await self.db.execute(
            select(TimetableSignoff).where(
                TimetableSignoff.realm_key == realm_key,
                TimetableSignoff.timetable_type == timetable_type,
            )
        )
        return result.scalar_one_or_none()

    async def save_signoff(self, signoff: TimetableSignoff) -> TimetableSignoff:
        self.db.add(signoff)
        await self.db.flush()
        await self.db.refresh(signoff)
        return signoff

    # ---------- Verifications ----------

    async def active_verification(
        self, semester_id: int, timetable_type: str, *, realm_key: str,
    ) -> TimetableVerification | None:
        """The FINAL issue that is still in force (not reopened), if any."""
        result = await self.db.execute(
            select(TimetableVerification)
            .where(
                TimetableVerification.realm_key == realm_key,
                TimetableVerification.semester_id == semester_id,
                TimetableVerification.timetable_type == timetable_type,
                TimetableVerification.reopened_at.is_(None),
            )
            .order_by(TimetableVerification.id.desc())
            .limit(1)
        )
        return result.scalars().first()

    async def issue_verification(
        self,
        semester_id: int,
        timetable_type: str,
        *,
        realm_key: str,
        locked_at: datetime | None,
        locked_by_email: str | None,
    ) -> TimetableVerification:
        """The active issue, or a new one. Locking an already-locked timetable
        keeps its code, so copies printed in between stay current."""
        active = await self.active_verification(semester_id, timetable_type, realm_key=realm_key)
        if active:
            return active
        code = new_verification_code(realm_key)
        while await self.get_verification_by_code(code):
            code = new_verification_code(realm_key)
        verification = TimetableVerification(
            code=code,
            realm_key=realm_key,
            semester_id=semester_id,
            timetable_type=timetable_type,
            locked_at=locked_at or datetime.now(timezone.utc),
            locked_by_email=locked_by_email,
        )
        self.db.add(verification)
        await self.db.flush()
        return verification

    async def reopen_verification(self, semester_id: int, timetable_type: str, *, realm_key: str) -> None:
        active = await self.active_verification(semester_id, timetable_type, realm_key=realm_key)
        if active:
            active.reopened_at = datetime.now(timezone.utc)
            await self.db.flush()

    async def get_verification_by_code(self, code: str) -> TimetableVerification | None:
        result = await self.db.execute(
            select(TimetableVerification).where(TimetableVerification.code == code)
        )
        return result.scalar_one_or_none()

    async def next_issue_after(self, verification: TimetableVerification) -> TimetableVerification | None:
        """The FINAL issue of the same timetable that replaced this one, if any."""
        result = await self.db.execute(
            select(TimetableVerification)
            .where(
                TimetableVerification.realm_key == verification.realm_key,
                TimetableVerification.semester_id == verification.semester_id,
                TimetableVerification.timetable_type == verification.timetable_type,
                TimetableVerification.id > verification.id,
            )
            .order_by(TimetableVerification.id)
            .limit(1)
        )
        return result.scalars().first()

    async def describe(self, verification: TimetableVerification) -> tuple[str, str, str] | None:
        """(realm name, session name, semester name) for a verification."""
        result = await self.db.execute(
            select(Realm.name, AcademicSession.name, Semester.name)
            .join(AcademicSession, AcademicSession.id == Semester.session_id)
            .join(Realm, Realm.key == AcademicSession.realm_key)
            .where(Semester.id == verification.semester_id)
        )
        row = result.first()
        return tuple(row) if row else None
