from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from core.database import get_db
from modules.calendar.models import AcademicSession, Semester

class CalendarRepository:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db


    async def create_session(self, session: AcademicSession) -> AcademicSession:
        self.db.add(session)
        await self.db.flush()
        return session
        
    async def get_sessions(self) -> list[AcademicSession]:
        result = await self.db.execute(select(AcademicSession))
        return list(result.scalars().all())

    async def create_semester(self, semester: Semester) -> Semester:
        self.db.add(semester)
        await self.db.flush()
        return semester
        
    async def get_semesters(self, session_id: int) -> list[Semester]:
        result = await self.db.execute(select(Semester).where(Semester.session_id == session_id))
        return list(result.scalars().all())

    async def get_current_semester(self) -> Semester | None:
        result = await self.db.execute(select(Semester).where(Semester.is_current == True))
        return result.scalar_one_or_none()
    
    async def disable_other_current_sessions(self):
        await self.db.execute(
            update(AcademicSession)
            .values(is_current=False)
        )
    async def disable_other_current_semesters(self, session_id: int):
        await self.db.execute(
            update(Semester)
            .where(Semester.session_id == session_id)
            .values(is_current=False)
        )

    async def disable_all_current_semesters(self):
        """Demote ALL semesters globally — used when a new session takes over."""
        await self.db.execute(
            update(Semester)
            .values(is_current=False)
        )
