from fastapi import Depends, HTTPException
from modules.auth.repository import AuthRepository
from modules.auth.models import User, RoleEnum, Invitation
from core.security import verify_password, create_access_token, get_password_hash

class AuthService:
    def __init__(self, repo: AuthRepository = Depends()):
        self.repo = repo

    async def authenticate_user(self, email: str, password: str) -> str:
        user = await self.repo.get_user_by_email(email)
        if not user or not verify_password(password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account disabled")
        
        token = create_access_token(data={"sub": str(user.id), "email": user.email, "role": user.role.value, "faculty_id": user.faculty_id})
        return token

    async def generate_invite(self, email: str, target_role: RoleEnum, faculty_id: str | None = None, semester_id: int | None = None) -> Invitation:
        import secrets
        from datetime import datetime, timedelta, timezone
        from modules.auth.models import Invitation

        existing_user = await self.repo.get_user_by_email(email)
        if existing_user:
            raise HTTPException(status_code=400, detail="User with this email already exists")
            
        existing_invites = await self.repo.get_invitations_by_email(email)
        for inv in existing_invites:
            if not inv.is_used and inv.expires_at > datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="An active invitation already exists for this email")

        token = secrets.token_urlsafe(32)
        invitation = Invitation(
            email=email,
            token=token,
            target_role=target_role,
            faculty_id=faculty_id,
            semester_id=semester_id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7)
        )
        return await self.repo.create_invitation(invitation)

    async def process_invitation(self, token: str, password: str) -> User:
        from core.security import get_password_hash
        from datetime import datetime, timezone

        invite = await self.repo.get_invitation_by_token(token)
        if not invite or invite.is_used or invite.expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Invalid or expired invitation")
            
        existing_user = await self.repo.get_user_by_email(invite.email)
        if existing_user:
            raise HTTPException(status_code=400, detail="User with this email already exists")
            
        new_user = User(
            email=invite.email,
            hashed_password=get_password_hash(password),
            role=invite.target_role,
            faculty_id=invite.faculty_id,
            semester_id=invite.semester_id
        )
        created_user = await self.repo.create_user(new_user)
        invite.is_used = True
        await self.repo.db.flush()
        
        # Notify super admins
        from modules.auth.models import RoleEnum
        from modules.notifications.service import NotificationService
        from modules.notifications.repository import NotificationRepository
        from modules.notifications.schemas import NotificationCreate
        
        super_admins = await self.repo.get_users_by_role(RoleEnum.SUPER_ADMIN)
        if super_admins:
            notif_repo = NotificationRepository(self.repo.db)
            notif_service = NotificationService(notif_repo)
            notifs = [
                NotificationCreate(
                    user_id=admin.id,
                    title="Staff Joined",
                    message=f"Staff member {new_user.email} has accepted their invitation and joined the system."
                ) for admin in super_admins
            ]
            await notif_service.create_bulk_notifications(notifs)

        return created_user

    async def get_all_users(self) -> list[User]:
        return await self.repo.get_all_users()

    async def get_all_invitations(self) -> list[Invitation]:
        return await self.repo.get_all_invitations()

    async def delete_user(self, user_id: int) -> bool:
        user = await self.repo.get_user_by_id(user_id)
        if not user: return False
        await self.repo.delete_user(user)
        return True

    async def delete_invitation(self, inv_id: int) -> bool:
        invitation = await self.repo.get_invitation_by_id(inv_id)
        if not invitation: return False
        await self.repo.delete_invitation(invitation)
        return True
