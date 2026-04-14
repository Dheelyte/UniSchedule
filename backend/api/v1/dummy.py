from fastapi import APIRouter, Depends
from modules.dummy.service import DummyService

router = APIRouter(prefix="/dummy", tags=["Dummy"])

@router.get("/")
async def get_dummy(service: DummyService = Depends()):
    return await service.get_health_status()
