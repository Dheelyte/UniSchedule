from fastapi import APIRouter, Depends
from modules.export.service import ExportService
from api.dependencies.auth import RequireRole, get_current_user
from modules.auth.models import RoleEnum

router = APIRouter(prefix="/export", tags=["Export"])

@router.get("/timetable")
async def export_timetable(
    session_id: int,
    semester_id: int,
    faculty_id: str | None = None,
    service: ExportService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]))
):
    return await service.generate_timetable_pdf(user, session_id, semester_id, faculty_id)
