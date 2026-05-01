from fastapi import APIRouter, Depends, Query
from modules.audit.service import AuditService
from modules.audit.schemas import ActivityLogResponse
from modules.auth.models import RoleEnum
from api.dependencies.auth import RequireRole

router = APIRouter(prefix="/audit", tags=["Audit"])


@router.get("/logs", response_model=list[ActivityLogResponse])
async def list_activity_logs(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    action_prefix: str | None = Query(None),
    user_id: int | None = Query(None),
    service: AuditService = Depends(),
    _user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.SUPER_VIEWER.value])),
):
    return await service.list(limit=limit, offset=offset, action_prefix=action_prefix, user_id=user_id)
