from typing import Literal

from fastapi import APIRouter, Depends, Query

from api.dependencies.auth import RequireRole, get_current_user
from modules.auth.models import RoleEnum
from modules.signoff.schemas import ExportSignoffResponse, SignoffResponse, SignoffUpdate, VerifyResponse
from modules.signoff.service import SignoffService

router = APIRouter(tags=["Sign-off"])


@router.get("/signoffs", response_model=list[SignoffResponse])
async def list_signoffs(
    service: SignoffService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value])),
):
    return await service.list_signoffs(user)


@router.put("/signoffs/{timetable_type}", response_model=SignoffResponse)
async def update_signoff(
    timetable_type: Literal["lecture", "exam"],
    data: SignoffUpdate,
    service: SignoffService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value])),
):
    return await service.update_signoff(timetable_type, data, user)


# Anyone who can export a timetable: a FINAL export is signed and stamped.
@router.get("/signoffs/export", response_model=ExportSignoffResponse)
async def export_signoff(
    semester_id: int = Query(...),
    timetable_type: Literal["lecture", "exam"] = Query(...),
    service: SignoffService = Depends(),
    user: dict = Depends(get_current_user),
):
    return await service.export_signoff(semester_id, timetable_type, user)


# Public: the QR code on a FINAL PDF opens /verify/<code>, which reads this.
@router.get("/verify/{code}", response_model=VerifyResponse)
async def verify(code: str, service: SignoffService = Depends()):
    return await service.verify(code)
