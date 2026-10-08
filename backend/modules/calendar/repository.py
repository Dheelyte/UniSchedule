from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from core.database import get_db
from modules.calendar.models import AcademicSession, Semester


def realm_semester_ids(realm_key: str):
    """Subquery: ids of the semesters in a realm (semesters inherit it from their session)."""
    return (
        select(Semester.id)
        .join(AcademicSession, AcademicSession.id == Semester.session_id)
        .where(AcademicSession.realm_key == realm_key)
    )


class CalendarRepository:
    """Sessions and semesters are realm-scoped: every read takes the realm."""

    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db


    async def create_session(self, session: AcademicSession) -> AcademicSession:
        self.db.add(session)
        await self.db.flush()
        return session

    async def get_sessions(self, *, realm_key: str) -> list[AcademicSession]:
        result = await self.db.execute(select(AcademicSession).where(AcademicSession.realm_key == realm_key))
        return list(result.scalars().all())

    async def get_session(self, id: int, *, realm_key: str) -> AcademicSession | None:
        result = await self.db.execute(
            select(AcademicSession).where(AcademicSession.id == id, AcademicSession.realm_key == realm_key)
        )
        return result.scalar_one_or_none()

    async def create_semester(self, semester: Semester) -> Semester:
        self.db.add(semester)
        await self.db.flush()
        return semester

    async def get_semesters(self, session_id: int, *, realm_key: str) -> list[Semester]:
        result = await self.db.execute(
            select(Semester).where(Semester.session_id == session_id, Semester.id.in_(realm_semester_ids(realm_key)))
        )
        return list(result.scalars().all())

    async def get_semester(self, id: int, *, realm_key: str) -> Semester | None:
        result = await self.db.execute(
            select(Semester).where(Semester.id == id, Semester.id.in_(realm_semester_ids(realm_key)))
        )
        return result.scalar_one_or_none()

    async def get_current_semester(self, *, realm_key: str) -> Semester | None:
        # A realm has one current semester; the newest wins if legacy data has more.
        result = await self.db.execute(
            select(Semester)
            .where(Semester.is_current == True, Semester.id.in_(realm_semester_ids(realm_key)))
            .order_by(Semester.id.desc())
            .limit(1)
        )
        return result.scalars().first()

    async def disable_current_sessions(self, *, realm_key: str):
        await self.db.execute(
            update(AcademicSession)
            .where(AcademicSession.realm_key == realm_key)
            .values(is_current=False)
        )

    async def disable_current_semesters(self, *, realm_key: str):
        """Demote every semester of the realm - a realm has one current semester."""
        await self.db.execute(
            update(Semester)
            .where(Semester.id.in_(realm_semester_ids(realm_key)))
            .values(is_current=False)
        )
