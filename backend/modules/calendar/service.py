from fastapi import Depends, HTTPException
from modules.calendar.repository import CalendarRepository
from modules.calendar.models import AcademicSession, Semester
from modules.calendar.schemas import SessionCreate, SemesterCreate

class CalendarService:
    def __init__(self, repo: CalendarRepository = Depends()):
        self.repo = repo

    async def create_session(self, data: SessionCreate, current_user: dict) -> AcademicSession:
        realm_key = current_user["realm"]
        # Only this realm's calendar moves on; other realms keep their current semester.
        await self.repo.disable_current_sessions(realm_key=realm_key)
        await self.repo.disable_current_semesters(realm_key=realm_key)  # demote semesters from all old sessions
        session = AcademicSession(
            name=data.name,
            is_current=True,
            realm_key=realm_key,
        )
        return await self.repo.create_session(session)

    async def get_sessions(self, current_user: dict) -> list[AcademicSession]:
        return await self.repo.get_sessions(realm_key=current_user["realm"])

    async def create_semester(self, data: SemesterCreate, current_user: dict) -> Semester:
        realm_key = current_user["realm"]
        if not await self.repo.get_session(data.session_id, realm_key=realm_key):
            raise HTTPException(status_code=404, detail="Session not found")
        names = current_user["realm_config"]["semester_names"]
        if data.name not in names:
            raise HTTPException(status_code=400, detail=f"Semester name must be one of: {', '.join(names)}")
        await self.repo.disable_current_semesters(realm_key=realm_key)
        semester = Semester(
            name=data.name,
            is_current=True,
            session_id=data.session_id
        )
        return await self.repo.create_semester(semester)

    async def get_semesters(self, session_id: int, current_user: dict) -> list[Semester]:
        return await self.repo.get_semesters(session_id, realm_key=current_user["realm"])

    async def get_current_semester(self, current_user: dict) -> Semester | None:
        return await self.repo.get_current_semester(realm_key=current_user["realm"])
