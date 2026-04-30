from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select, update
from sqlalchemy.orm import joinedload
from core.database import get_db
from modules.auth.models import PasswordResetToken, User, Invitation, RoleEnum

class AuthRepository:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def get_user_by_email(self, email: str) -> User | None:
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalars().first()

    async def get_invitations_by_email(self, email: str) -> list[Invitation]:
        result = await self.db.execute(select(Invitation).where(Invitation.email == email))
        return list(result.scalars().all())

    async def create_user(self, user: User) -> User:
        self.db.add(user)
        await self.db.flush()
        return user

    async def get_invitation_by_token(self, token: str) -> Invitation | None:
        result = await self.db.execute(select(Invitation).where(Invitation.token == token))
        return result.scalars().first()
    
    async def create_invitation(self, invitation: Invitation) -> Invitation:
        self.db.add(invitation)
        await self.db.flush()
        return invitation

    async def get_all_users(self) -> list[User]:
        result = await self.db.execute(select(User))
        return list(result.scalars().all())

    async def get_users_by_role(self, role: RoleEnum) -> list[User]:
        result = await self.db.execute(select(User).where(User.role == role))
        return list(result.scalars().all())

    async def get_users_by_ids(self, ids: list[int]) -> list[User]:
        if not ids:
            return []
        result = await self.db.execute(select(User).where(User.id.in_(ids)))
        return list(result.scalars().all())


    async def get_all_invitations(self) -> list[Invitation]:
        result = await self.db.execute(select(Invitation).where(Invitation.is_used.is_(False)))
        return list(result.scalars().all())
    
    async def get_user_by_id(self, id: int) -> User | None:
        result = await self.db.execute(select(User).where(User.id == id))
        return result.scalars().first()

    async def delete_user(self, user: User) -> None:
        await self.db.delete(user)
        await self.db.flush()

    async def get_invitation_by_id(self, id: int) -> Invitation | None:
        result = await self.db.execute(select(Invitation).where(Invitation.id == id))
        return result.scalars().first()

    async def delete_invitation(self, invitation: Invitation) -> None:
        await self.db.delete(invitation)
        await self.db.flush()


class PasswordRepository:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def add(self, reset_token: PasswordResetToken):
        self.db.add(reset_token)
        await self.db.flush()

    async def get_token(self, code_hash: str, email: str):
        stmt = (
            select(PasswordResetToken)
            .join(User)
            .options(joinedload(PasswordResetToken.user))
            .where(
                PasswordResetToken.code_hash == code_hash,
                PasswordResetToken.is_used.is_(False),
                PasswordResetToken.expires_at > func.now(),
                User.email == email,
            )
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
    
    async def update_token(self, user_id: int):
        stmt = (
            update(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == user_id,
                PasswordResetToken.is_used.is_(False),
            )
            .values(is_used=True)
        )
        await self.db.execute(stmt)
