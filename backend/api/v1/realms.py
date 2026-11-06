from fastapi import APIRouter, Depends
from modules.realms.service import RealmService
from modules.realms.schemas import RealmResponse, RealmUpdate
from modules.auth.models import RoleEnum
from api.dependencies.auth import RequireRole

router = APIRouter(prefix="/realms", tags=["Realms"])


# Public: the /realms and /login pages read this before anyone is signed in.
@router.get("", response_model=list[RealmResponse])
async def get_realm_list(service: RealmService = Depends()):
    return await service.get_realms()


@router.put("/{key}", response_model=RealmResponse)
async def update_realm(
    key: str,
    data: RealmUpdate,
    service: RealmService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value])),
):
    return await service.update_realm(key, data, user)
