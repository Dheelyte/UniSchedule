from fastapi import APIRouter, Depends

from api.dependencies.auth import RequireRole, get_current_user
from modules.auth.models import RoleEnum
from modules.editor_access.schemas import (
    EditorAccessStatus,
    GrantEditorAccessRequest,
    HandoverResponse,
    RetractEditorAccessRequest,
)
from modules.editor_access.service import EditorAccessService

router = APIRouter(prefix="/editor-access", tags=["Editor access"])


@router.get("", response_model=EditorAccessStatus)
async def get_status(service: EditorAccessService = Depends(), user: dict = Depends(get_current_user)):
    """What the signed-in staff member may do with editor access.

    Open to any signed-in user so an editor who handed their access over (and
    is now a Faculty Viewer) can still reach the retract controls; everyone
    else gets an empty answer.
    """
    return await service.status(user)


@router.post("/grant")
async def grant(
    data: GrantEditorAccessRequest,
    service: EditorAccessService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.FACULTY_EDITOR.value])),
):
    await service.grant(user, data.user_id)
    return {"message": "Editor access granted"}


@router.post("/retract")
async def retract(
    data: RetractEditorAccessRequest,
    service: EditorAccessService = Depends(),
    # The original editor is a Faculty Viewer while their access is handed over.
    user: dict = Depends(RequireRole([RoleEnum.FACULTY_VIEWER.value])),
):
    await service.retract(user, data.to_user_id)
    return {"message": "Editor access retracted"}


@router.get("/handovers", response_model=list[HandoverResponse])
async def list_handovers(
    service: EditorAccessService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value])),
):
    return await service.list_active(user)


@router.post("/handovers/{handover_id}/reverse")
async def reverse_handover(
    handover_id: int,
    service: EditorAccessService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value])),
):
    await service.reverse_by_admin(user, handover_id)
    return {"message": "Handover reversed"}
