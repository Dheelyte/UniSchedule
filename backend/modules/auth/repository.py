from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from core.database import get_db
from modules.auth.models import User, Invitation, RoleEnum

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


    async def get_all_invitations(self) -> list[Invitation]:
        result = await self.db.execute(select(Invitation))
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
