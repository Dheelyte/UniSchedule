from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from core.database import get_db

class DummyRepository:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def check_db_health(self) -> str:
        # A simple query to ensure the session operates correctly
        result = await self.db.execute(text("SELECT 1"))
        return f"Database OK, computed {result.scalar()}"
