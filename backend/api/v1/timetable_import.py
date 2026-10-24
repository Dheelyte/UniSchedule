import io

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import ValidationError

from api.dependencies.auth import RequireRole
from modules.auth.models import RoleEnum
from modules.timetable_import.schemas import ImportOptions
from modules.timetable_import.service import TimetableImportService

router = APIRouter(prefix="/timetable-import", tags=["Timetable import"])

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
super_admin = RequireRole([RoleEnum.SUPER_ADMIN.value])


async def _read(file: UploadFile, options: str) -> tuple:
    try:
        parsed = ImportOptions.model_validate_json(options)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False, include_context=False))
    if not (file.filename or "").lower().endswith((".xlsx", ".docx")):
        raise HTTPException(status_code=400, detail="Upload an Excel (.xlsx) or Word (.docx) file")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The file is larger than 5 MB")
    parsed.file_name = file.filename
    return io.BytesIO(data), parsed


@router.post("/preview")
async def preview_import(
    file: UploadFile = File(...),
    options: str = Form(...),
    service: TimetableImportService = Depends(),
    user: dict = Depends(super_admin),
):
    data, parsed = await _read(file, options)
    return await service.preview(data, parsed, user)


@router.post("/apply")
async def apply_import(
    file: UploadFile = File(...),
    options: str = Form(...),
    service: TimetableImportService = Depends(),
    user: dict = Depends(super_admin),
):
    data, parsed = await _read(file, options)
    return await service.apply(data, parsed, user)


@router.get("/copy/sources")
async def copy_sources(service: TimetableImportService = Depends(), user: dict = Depends(super_admin)):
    return await service.copy_sources(user)


@router.post("/copy/preview")
async def preview_copy(options: ImportOptions, service: TimetableImportService = Depends(), user: dict = Depends(super_admin)):
    return await service.copy_preview(options, user)


@router.post("/copy/apply")
async def apply_copy(options: ImportOptions, service: TimetableImportService = Depends(), user: dict = Depends(super_admin)):
    return await service.copy_apply(options, user)


@router.get("/imports")
async def list_imports(
    item_type: Literal["lecture", "exam"] | None = None,
    limit: int = Query(50, ge=1, le=200),
    service: TimetableImportService = Depends(),
    user: dict = Depends(super_admin),
):
    return await service.list_imports(user, item_type=item_type, limit=limit)


@router.post("/imports/{import_id}/revert")
async def revert_import(
    import_id: int,
    service: TimetableImportService = Depends(),
    user: dict = Depends(super_admin),
):
    return await service.revert(import_id, user)
