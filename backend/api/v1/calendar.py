from fastapi import APIRouter, Depends
from modules.calendar.service import CalendarService
from modules.calendar.schemas import (
    SessionCreate, SessionResponse,
    SemesterCreate, SemesterResponse
)
from api.dependencies.auth import RequireRole, get_current_user
from modules.auth.models import RoleEnum

router = APIRouter(prefix="/calendar", tags=["Calendar"])


@router.post("/sessions", response_model=SessionResponse)
async def create_sess(
    data: SessionCreate,
    service: CalendarService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))
):
    return await service.create_session(data)

@router.get("/sessions", response_model=list[SessionResponse])
async def get_session_list(
    service: CalendarService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.get_sessions()

@router.post("/semesters", response_model=SemesterResponse)
async def create_sem(
    data: SemesterCreate,
    service: CalendarService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))
):
    return await service.create_semester(data)

@router.get("/sessions/{sess_id}/semesters", response_model=list[SemesterResponse])
async def get_semester_list(
    sess_id: int,
    service: CalendarService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.get_semesters(sess_id)

@router.get("/semesters/current", response_model=SemesterResponse | None)
async def get_current_semester(
    service: CalendarService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.get_current_semester()
