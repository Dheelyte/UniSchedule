from fastapi import Depends, HTTPException
from modules.calendar.repository import CalendarRepository
from modules.calendar.models import AcademicSession, Semester
from modules.calendar.schemas import SessionCreate, SemesterCreate
from modules.audit.service import AuditService

class CalendarService:
    def __init__(self, repo: CalendarRepository = Depends(), audit_service: AuditService = Depends()):
        self.repo = repo
        self.audit_service = audit_service

    async def create_session(self, data: SessionCreate, current_user: dict) -> AcademicSession:
        # A new session is inactive until a super admin makes it current.
        session = AcademicSession(
            name=data.name,
            is_current=False,
            realm_key=current_user["realm"],
        )
        created = await self.repo.create_session(session)
        await self.audit_service.log(
            current_user=current_user,
            action="calendar.session.create",
            entity_type="academic_session",
            entity_id=created.id,
            description=f"Added session {created.name}",
        )
        return created

    async def get_sessions(self, current_user: dict) -> list[AcademicSession]:
        return await self.repo.get_sessions(realm_key=current_user["realm"])

    async def create_semester(self, data: SemesterCreate, current_user: dict) -> Semester:
        realm_key = current_user["realm"]
        session = await self.repo.get_session(data.session_id, realm_key=realm_key)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        # Sessions other than the current one are view-only.
        if not session.is_current:
            raise HTTPException(status_code=400, detail="Semesters can only be added to the current session")
        names = current_user["realm_config"]["semester_names"]
        if data.name not in names:
            raise HTTPException(status_code=400, detail=f"Semester name must be one of: {', '.join(names)}")
        # A new semester is inactive until a super admin makes it current.
        semester = Semester(
            name=data.name,
            is_current=False,
            session_id=data.session_id
        )
        created = await self.repo.create_semester(semester)
        await self.audit_service.log(
            current_user=current_user,
            action="calendar.semester.create",
            entity_type="semester",
            entity_id=created.id,
            description=f"Added {created.name} to session {session.name}",
        )
        return created

    async def set_current_session(self, session_id: int, current_user: dict) -> AcademicSession:
        """Make a session current. Its newest semester, if any, becomes the current semester."""
        realm_key = current_user["realm"]
        session = await self.repo.get_session(session_id, realm_key=realm_key)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        # Only this realm's calendar moves; other realms keep their current semester.
        await self.repo.disable_current_sessions(realm_key=realm_key)
        await self.repo.disable_current_semesters(realm_key=realm_key)
        await self.repo.mark_session_current(session.id, realm_key=realm_key)
        semesters = await self.repo.get_semesters(session.id, realm_key=realm_key)
        if semesters:
            newest = max(semesters, key=lambda s: s.id)
            await self.repo.mark_semester_current(newest.id, realm_key=realm_key)
        await self.repo.db.refresh(session)
        await self.audit_service.log(
            current_user=current_user,
            action="calendar.session.current",
            entity_type="academic_session",
            entity_id=session.id,
            description=f"Made {session.name} the current session",
            extra={"current_semester_id": newest.id if semesters else None},
        )
        return session

    async def set_current_semester(self, semester_id: int, current_user: dict) -> Semester:
        realm_key = current_user["realm"]
        semester = await self.repo.get_semester(semester_id, realm_key=realm_key)
        if not semester:
            raise HTTPException(status_code=404, detail="Semester not found")
        session = await self.repo.get_session(semester.session_id, realm_key=realm_key)
        if not session.is_current:
            raise HTTPException(status_code=400, detail="Make this semester's session current first")
        await self.repo.disable_current_semesters(realm_key=realm_key)
        await self.repo.mark_semester_current(semester.id, realm_key=realm_key)
        await self.repo.db.refresh(semester)
        await self.audit_service.log(
            current_user=current_user,
            action="calendar.semester.current",
            entity_type="semester",
            entity_id=semester.id,
            description=f"Made {semester.name} of {session.name} the current semester",
        )
        return semester

    async def get_semesters(self, session_id: int, current_user: dict) -> list[Semester]:
        return await self.repo.get_semesters(session_id, realm_key=current_user["realm"])

    async def get_current_semester(self, current_user: dict) -> Semester | None:
        return await self.repo.get_current_semester(realm_key=current_user["realm"])
