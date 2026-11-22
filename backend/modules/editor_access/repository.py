from fastapi import Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from modules.auth.models import RoleEnum, User
from modules.editor_access.models import EditorHandover
from modules.realms.defaults import DEFAULT_REALM_KEY


class EditorAccessRepository:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def lock_users(self, ids: list[int]) -> dict[int, User]:
        """Load and row-lock these accounts until the transaction ends.

        Callers lock the original editor first, then the others, so two
        handover changes on the same people queue up instead of racing.
        """
        ids = sorted({i for i in ids if i is not None})
        if not ids:
            return {}
        result = await self.db.execute(
            select(User).where(User.id.in_(ids)).order_by(User.id).with_for_update()
        )
        return {user.id: user for user in result.scalars().all()}

    async def active_by_grantor(self, user_id: int) -> EditorHandover | None:
        result = await self.db.execute(
            select(EditorHandover).where(
                EditorHandover.granted_by_id == user_id, EditorHandover.ended_at.is_(None)
            )
        )
        return result.scalars().first()

    async def active_by_holder(self, user_id: int) -> EditorHandover | None:
        result = await self.db.execute(
            select(EditorHandover).where(
                EditorHandover.holder_id == user_id, EditorHandover.ended_at.is_(None)
            )
        )
        return result.scalars().first()

    async def get_active(self, handover_id: int, *, realm_key: str) -> EditorHandover | None:
        result = await self.db.execute(
            select(EditorHandover).where(
                EditorHandover.id == handover_id,
                EditorHandover.realm_key == realm_key,
                EditorHandover.ended_at.is_(None),
            )
        )
        return result.scalars().first()

    async def list_active(self, *, realm_key: str) -> list[EditorHandover]:
        result = await self.db.execute(
            select(EditorHandover)
            .where(EditorHandover.realm_key == realm_key, EditorHandover.ended_at.is_(None))
            .order_by(EditorHandover.started_at)
        )
        return list(result.scalars().all())

    async def viewers_without_handover(self, faculty_id: str, *, realm_key: str, exclude_id: int) -> list[User]:
        """Active Faculty Viewers of a faculty who could receive editor access.

        Only the FACULTY_VIEWER role: Heads of Department (HOD) never receive
        editor access, so they are never offered to grant or redirect to.
        Leaves out viewers who have handed their own editor access over: they
        must take it back rather than be given someone else's.
        """
        handed_over = select(EditorHandover.granted_by_id).where(
            EditorHandover.ended_at.is_(None), EditorHandover.granted_by_id.is_not(None)
        )
        result = await self.db.execute(
            select(User)
            .where(
                User.role == RoleEnum.FACULTY_VIEWER,
                User.faculty_id == faculty_id,
                User.is_active.is_(True),
                func.coalesce(User.realm_key, DEFAULT_REALM_KEY) == realm_key,
                User.id != exclude_id,
                User.id.not_in(handed_over),
            )
            .order_by(User.email)
        )
        return list(result.scalars().all())

    async def add(self, handover: EditorHandover) -> EditorHandover:
        self.db.add(handover)
        await self.db.flush()
        return handover
