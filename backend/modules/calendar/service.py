from fastapi import Depends
from modules.calendar.repository import CalendarRepository
from modules.calendar.models import AcademicSession, Semester
from modules.calendar.schemas import SessionCreate, SemesterCreate

class CalendarService:
    def __init__(self, repo: CalendarRepository = Depends()):
        self.repo = repo

    async def create_session(self, data: SessionCreate) -> AcademicSession:
        await self.repo.disable_other_current_sessions()
        await self.repo.disable_all_current_semesters()  # demote semesters from all old sessions
        session = AcademicSession(
            name=data.name,
            is_current=True
        )
        return await self.repo.create_session(session)

    async def get_sessions(self) -> list[AcademicSession]:
        return await self.repo.get_sessions()

    async def create_semester(self, data: SemesterCreate) -> Semester:
        await self.repo.disable_other_current_semesters(data.session_id)
        semester = Semester(
            name=data.name,
            is_current=True,
            session_id=data.session_id
        )
        return await self.repo.create_semester(semester)

    async def get_semesters(self, session_id: int) -> list[Semester]:
        return await self.repo.get_semesters(session_id)

    async def get_current_semester(self) -> Semester | None:
        return await self.repo.get_current_semester()
