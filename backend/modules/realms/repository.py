from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from modules.realms.models import Realm


class RealmRepository:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def get_realms(self) -> list[Realm]:
        result = await self.db.execute(select(Realm).order_by(Realm.sort_order, Realm.key))
        return list(result.scalars().all())

    async def get_realm(self, key: str) -> Realm | None:
        return await self.db.get(Realm, key)

    async def save(self, realm: Realm) -> Realm:
        self.db.add(realm)
        await self.db.flush()
        return realm
