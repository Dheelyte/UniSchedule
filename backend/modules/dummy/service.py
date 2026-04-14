from fastapi import Depends
from modules.dummy.repository import DummyRepository

class DummyService:
    def __init__(self, repo: DummyRepository = Depends()):
        self.repo = repo

    async def get_health_status(self) -> dict:
        db_status = await self.repo.check_db_health()
        return {
            "status": "ok",
            "db_status": db_status,
            "message": "Service layer responding correctly"
        }
