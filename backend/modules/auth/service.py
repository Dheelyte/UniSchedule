import secrets
from datetime import datetime, timezone, timedelta

from fastapi import Depends, HTTPException

from core.mail import EmailService
from modules.auth.repository import AuthRepository, PasswordRepository
from modules.auth.models import PasswordResetToken, User, RoleEnum, Invitation
from core.security import TokenGenerator, verify_password, create_access_token, get_password_hash, hash_code
from core.config import settings
from modules.audit.service import AuditService

class AuthService:
    def __init__(self, repo: AuthRepository = Depends(), audit_service: AuditService = Depends()):
        self.repo = repo
        self.audit_service = audit_service

    async def authenticate_user(self, email: str, password: str) -> str:
        user = await self.repo.get_user_by_email(email)
        if not user or not verify_password(password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account disabled")

        token = create_access_token(data={"sub": str(user.id), "email": user.email, "role": user.role.value, "faculty_id": user.faculty_id})
        await self.audit_service.log(
            current_user={"sub": str(user.id), "email": user.email, "role": user.role.value, "faculty_id": user.faculty_id},
            action="auth.login",
            entity_type="user",
            entity_id=user.id,
            description=f"{user.email} logged in",
        )
        return token

    async def generate_invite(self, email: str, target_role: RoleEnum, faculty_id: str | None = None, semester_id: int | None = None, current_user: dict | None = None) -> Invitation:
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
        created = await self.repo.create_invitation(invitation)
        await self.audit_service.log(
            current_user=current_user,
            action="user.invite",
            entity_type="invitation",
            entity_id=created.id,
            description=f"Invited {email} as {target_role.value}",
            extra={"email": email, "role": target_role.value, "faculty_id": faculty_id},
        )
        return created

    async def process_invitation(self, token: str, password: str) -> User:
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
        await self.audit_service.log(
            current_user={"sub": str(created_user.id), "email": created_user.email, "role": created_user.role.value, "faculty_id": created_user.faculty_id},
            action="user.register",
            entity_type="user",
            entity_id=created_user.id,
            description=f"{created_user.email} registered as {created_user.role.value}",
        )
        return created_user

    async def get_all_users(self) -> list[User]:
        return await self.repo.get_all_users()
    
    async def get_user_by_email(self, email: str) -> User:
        return await self.repo.get_user_by_email(email)

    async def get_all_invitations(self) -> list[Invitation]:
        return await self.repo.get_all_invitations()

    async def delete_user(self, user_id: int, current_user: dict | None = None) -> bool:
        user = await self.repo.get_user_by_id(user_id)
        if not user: return False
        email = user.email
        role = user.role.value
        await self.repo.delete_user(user)
        await self.audit_service.log(
            current_user=current_user,
            action="user.delete",
            entity_type="user",
            entity_id=user_id,
            description=f"Deleted user {email} ({role})",
        )
        return True

    async def delete_invitation(self, inv_id: int, current_user: dict | None = None) -> bool:
        invitation = await self.repo.get_invitation_by_id(inv_id)
        if not invitation: return False
        email = invitation.email
        await self.repo.delete_invitation(invitation)
        await self.audit_service.log(
            current_user=current_user,
            action="user.invite_revoke",
            entity_type="invitation",
            entity_id=inv_id,
            description=f"Revoked invitation for {email}",
        )
        return True

class PasswordResetService:
    def __init__(self, repo: PasswordRepository = Depends()):
        self.repo = repo
    
    async def create_reset_code(self, user: User) -> str:
        """
        Create a password reset code for user.
        Invalidates all previous codes.

        Returns: The unhashed code to send to user
        """
        # Invalidate all previous unused codes for this user
        await self.invalidate_unused_verification_codes(user)
        code = TokenGenerator.generate_code()
        code_hash = hash_code(code)
        token = PasswordResetToken(
            code_hash=code_hash,
            user_id=user.id,
            expires_at=datetime.now(timezone.utc)
            + timedelta(minutes=settings.PASSWORD_RESET_CODE_EXPIRE_MINUTES),
            is_used=False,
        )
        await self.repo.add(token)
        return code

    async def verify_reset_code(
        self, code: str, email: str
    ) -> PasswordResetToken | None:
        """
        Return the valid PasswordResetToken DB object (not boolean).
        This is preferred so the caller can access token.user_id etc
        and so we can mark it used atomically in reset_password_with_token.
        """
        code_hash = hash_code(code)
        return await self.repo.get_token(code_hash, email)

    async def reset_password_with_token(
        self, token_obj: PasswordResetToken, new_password: str
    ):
        """
        Update the user's password and mark the token used.
        """
        user: User = token_obj.user
        user.hashed_password = get_password_hash(new_password)
        token_obj.is_used = True
        await self.repo.db.flush()

    async def invalidate_unused_verification_codes(self, user: User):
        """Invalidate other unused tokens"""
        await self.repo.update_token(user.id)

    async def send_password_reset_email(self, user: User, code: str):
        await EmailService.send_password_reset_email(
            recipients=[user.email],
            title="Reset your password",
            code=code
        )
