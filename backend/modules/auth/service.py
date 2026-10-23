import secrets
from datetime import datetime, timezone, timedelta

from fastapi import Depends, HTTPException

from core.mail import EmailService
from modules.auth.repository import AuthRepository, PasswordRepository, is_in_realm
from modules.auth.models import PasswordResetToken, User, RoleEnum, Invitation, CROSS_REALM_ROLES, stored_realm_key
from core.security import TokenGenerator, verify_password, create_access_token, get_password_hash, hash_code
from core.config import settings
from modules.auth.schemas import UpdateUserRoleRequest
from modules.audit.service import AuditService
from modules.realms.defaults import DEFAULT_REALM_KEY
from modules.realms.repository import RealmRepository

# Roles a super admin may assume (everything except SUPER_ADMIN itself).
IMPERSONABLE_ROLES = {
    RoleEnum.FACULTY_EDITOR,
    RoleEnum.FACULTY_VIEWER,
    RoleEnum.GS_ADMIN,
    RoleEnum.SUPER_VIEWER,
    RoleEnum.CITS_ADMIN,
}
# Assumed roles that must be scoped to a specific faculty.
FACULTY_SCOPED_ROLES = {RoleEnum.FACULTY_EDITOR, RoleEnum.FACULTY_VIEWER}
# Accounts with these roles must belong to a faculty.
FACULTY_BOUND_ROLES = FACULTY_SCOPED_ROLES | {RoleEnum.DEO}


class AuthService:
    def __init__(
        self,
        repo: AuthRepository = Depends(),
        audit_service: AuditService = Depends(),
        realm_repo: RealmRepository = Depends(),
    ):
        self.repo = repo
        self.audit_service = audit_service
        self.realm_repo = realm_repo

    @staticmethod
    def _plain_token(user: User, realm_key: str) -> str:
        """A normal (non-impersonating) session token for `user` in a realm."""
        return create_access_token(data={
            "sub": str(user.id),
            "email": user.email,
            "role": user.role.value,
            "faculty_id": user.faculty_id,
            "realm": realm_key,
        })

    async def impersonate(self, current_user: dict, target_role: RoleEnum, faculty_id: str | None) -> str:
        """Mint an impersonation token for a super admin to act as another role.

        Authorization is checked against the real DB-derived role so a super
        admin can switch targets without first exiting impersonation.
        """
        if current_user.get("real_role") != RoleEnum.SUPER_ADMIN.value:
            raise HTTPException(status_code=403, detail="Only super admins can assume another role")
        if target_role == RoleEnum.SUPER_ADMIN or target_role not in IMPERSONABLE_ROLES:
            raise HTTPException(status_code=400, detail="This role cannot be assumed")

        if target_role in FACULTY_SCOPED_ROLES:
            if not faculty_id:
                raise HTTPException(status_code=400, detail=f"{target_role.value} requires a faculty")
            if not await self.repo.faculty_exists(faculty_id, realm_key=current_user["realm"]):
                raise HTTPException(status_code=404, detail="Faculty not found")
        else:
            # Global roles carry no single-faculty scope.
            faculty_id = None

        impersonator_id = current_user.get("sub")
        impersonator_email = current_user.get("email")
        token = create_access_token(data={
            "sub": impersonator_id,
            "email": impersonator_email,
            "role": RoleEnum.SUPER_ADMIN.value,
            "faculty_id": None,
            "act_as_role": target_role.value,
            "act_as_faculty_id": faculty_id,
            "impersonator_id": impersonator_id,
            # Acting as another role happens inside the realm already chosen.
            "realm": current_user.get("realm"),
        })
        await self.audit_service.log(
            current_user=current_user,
            action="auth.impersonate.start",
            entity_type="user",
            entity_id=int(impersonator_id) if impersonator_id else None,
            description=f"{impersonator_email} started acting as {target_role.value}"
            + (f" (faculty {faculty_id})" if faculty_id else ""),
            extra={"act_as_role": target_role.value, "act_as_faculty_id": faculty_id},
        )
        return token

    async def stop_impersonation(self, current_user: dict) -> str:
        """Re-mint a normal token for the underlying super admin."""
        user_id = current_user.get("impersonator_id") or current_user.get("sub")
        user = await self.repo.get_user_by_id(int(user_id))
        if not user:
            raise HTTPException(status_code=401, detail="Account no longer exists")
        token = self._plain_token(user, current_user.get("realm") or DEFAULT_REALM_KEY)
        await self.audit_service.log(
            current_user={"sub": str(user.id), "email": user.email, "role": user.role.value, "faculty_id": user.faculty_id, "realm": current_user.get("realm")},
            action="auth.impersonate.stop",
            entity_type="user",
            entity_id=user.id,
            description=f"{user.email} stopped impersonating",
        )
        return token

    async def switch_realm(self, current_user: dict, realm_key: str) -> str:
        """Re-mint a plain token in another realm, which ends any impersonation.

        Authorized on the real DB-derived role, like impersonation.
        """
        if current_user.get("real_role") not in {role.value for role in CROSS_REALM_ROLES}:
            raise HTTPException(status_code=403, detail="This account belongs to one portal and can't switch")
        realm = await self.realm_repo.get_realm(realm_key)
        if not realm:
            raise HTTPException(status_code=400, detail="Unknown portal")
        user = await self.repo.get_user_by_id(int(current_user["sub"]))
        if not user:
            raise HTTPException(status_code=401, detail="Account no longer exists")

        token = self._plain_token(user, realm.key)
        await self.audit_service.log(
            current_user={"sub": str(user.id), "email": user.email, "role": user.role.value, "faculty_id": user.faculty_id},
            action="auth.switch_realm",
            entity_type="user",
            entity_id=user.id,
            description=f"{user.email} switched to the {realm.name} portal",
            extra={"from_realm": current_user.get("realm"), "to_realm": realm.key},
        )
        return token

    async def authenticate_user(self, email: str, password: str, realm_key: str | None = None) -> str:
        user = await self.repo.get_user_by_email(email)
        if not user or not verify_password(password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account disabled")

        # A non-live realm is fine: staff set it up before launch.
        if realm_key is not None and not await self.realm_repo.get_realm(realm_key):
            raise HTTPException(status_code=400, detail="Unknown portal")
        if user.role in CROSS_REALM_ROLES:
            realm_key = realm_key or DEFAULT_REALM_KEY
        else:
            own_key = user.realm_key or DEFAULT_REALM_KEY
            if realm_key is not None and realm_key != own_key:
                own = await self.realm_repo.get_realm(own_key)
                raise HTTPException(status_code=403, detail=f"This account belongs to the {own.name} portal.")
            realm_key = own_key

        token = self._plain_token(user, realm_key)
        await self.audit_service.log(
            current_user={"sub": str(user.id), "email": user.email, "role": user.role.value, "faculty_id": user.faculty_id, "realm": realm_key},
            action="auth.login",
            entity_type="user",
            entity_id=user.id,
            description=f"{user.email} logged in",
        )
        return token

    async def generate_invite(self, email: str, target_role: RoleEnum, faculty_id: str | None = None, semester_id: int | None = None, *, current_user: dict) -> Invitation:
        existing_user = await self.repo.get_user_by_email(email)
        if existing_user:
            raise HTTPException(status_code=400, detail="User with this email already exists")
            
        existing_invites = await self.repo.get_invitations_by_email(email)
        for inv in existing_invites:
            if not inv.is_used and inv.expires_at > datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="An active invitation already exists for this email")

        # A faculty belongs to one realm, so the account can only be bound to one of the inviter's.
        if faculty_id and not await self.repo.faculty_exists(faculty_id, realm_key=current_user["realm"]):
            raise HTTPException(status_code=404, detail="Faculty not found")

        token = secrets.token_urlsafe(32)
        invitation = Invitation(
            email=email,
            token=token,
            target_role=target_role,
            faculty_id=faculty_id,
            semester_id=semester_id,
            # Realm-bound roles join the inviter's active realm; cross-realm roles have none.
            realm_key=stored_realm_key(target_role, current_user["realm"]),
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
            semester_id=invite.semester_id,
            realm_key=stored_realm_key(invite.target_role, invite.realm_key or DEFAULT_REALM_KEY),
        )
        created_user = await self.repo.create_user(new_user)
        invite.is_used = True
        await self.repo.db.flush()
        await self.audit_service.log(
            current_user={"sub": str(created_user.id), "email": created_user.email, "role": created_user.role.value, "faculty_id": created_user.faculty_id, "realm": invite.realm_key},
            action="user.register",
            entity_type="user",
            entity_id=created_user.id,
            description=f"{created_user.email} registered as {created_user.role.value}",
        )
        return created_user

    async def get_users(self, *, realm_key: str, faculty_id: str | None = None) -> list[User]:
        users = await self.repo.get_users(realm_key=realm_key)
        if faculty_id:
            users = [u for u in users if u.faculty_id == faculty_id]
        return users

    async def get_user_by_email(self, email: str) -> User:
        return await self.repo.get_user_by_email(email)

    async def get_invitations(self, *, realm_key: str, faculty_id: str | None = None) -> list[Invitation]:
        invites = await self.repo.get_invitations(realm_key=realm_key)
        if faculty_id:
            invites = [i for i in invites if i.faculty_id == faculty_id]
        return invites

    async def delete_user(self, user_id: int, current_user: dict) -> bool:
        user = await self.repo.get_user_by_id(user_id)
        # An account in another realm behaves like a missing one.
        if not user or not is_in_realm(user.role, user.realm_key, current_user["realm"]): return False
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

    async def update_user_role(self, user_id: int, data: UpdateUserRoleRequest, current_user: dict) -> User:
        user = await self.repo.get_user_by_id(user_id)
        # An account in another realm behaves like a missing one.
        if not user or not is_in_realm(user.role, user.realm_key, current_user["realm"]):
            raise HTTPException(status_code=404, detail="User not found")
        if str(user.id) == str(current_user.get("sub", "")):
            raise HTTPException(status_code=400, detail="You cannot change your own role")

        if data.role in FACULTY_BOUND_ROLES:
            if not data.faculty_id:
                raise HTTPException(status_code=400, detail="A faculty is required for this role")
            if not await self.repo.faculty_exists(data.faculty_id, realm_key=current_user["realm"]):
                raise HTTPException(status_code=404, detail="Faculty not found")
            faculty_id = data.faculty_id
        else:
            faculty_id = None

        if user.role == data.role and user.faculty_id == faculty_id and user.semester_id == data.semester_id:
            return user

        if user.role == RoleEnum.SUPER_ADMIN and data.role != RoleEnum.SUPER_ADMIN:
            if len(await self.repo.get_users_by_role(RoleEnum.SUPER_ADMIN)) <= 1:
                raise HTTPException(status_code=400, detail="There must be at least one Super Admin; this is the last one")

        from_role, from_faculty_id, from_realm_key = user.role, user.faculty_id, user.realm_key
        user.role = data.role
        user.faculty_id = faculty_id
        user.semester_id = data.semester_id
        # Cross-realm roles have no realm; a realm-bound role joins the admin's active realm.
        user.realm_key = stored_realm_key(data.role, current_user["realm"])
        await self.repo.db.flush()
        # Reload: an explicit SQL NULL leaves realm_key expired after the flush.
        await self.repo.db.refresh(user)

        scope = f" (faculty {faculty_id})" if faculty_id else ""
        await self.audit_service.log(
            current_user=current_user,
            action="user.role_change",
            entity_type="user",
            entity_id=user.id,
            description=f"Changed {user.email} from {from_role.value} to {data.role.value}{scope}",
            extra={
                "from_role": from_role.value,
                "to_role": data.role.value,
                "from_faculty_id": from_faculty_id,
                "to_faculty_id": faculty_id,
                "from_realm_key": from_realm_key,
                "to_realm_key": user.realm_key,
            },
        )
        return user

    async def delete_invitation(self, inv_id: int, current_user: dict) -> bool:
        invitation = await self.repo.get_invitation_by_id(inv_id)
        if not invitation or not is_in_realm(invitation.target_role, invitation.realm_key, current_user["realm"]): return False
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
