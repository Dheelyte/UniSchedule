from fastapi import Request, Depends, HTTPException
from core.security import decode_access_token
from modules.auth.repository import AuthRepository
from modules.auth.models import RoleEnum

async def get_token_from_cookie(request: Request) -> str:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return token

async def get_current_user(
    token: str = Depends(get_token_from_cookie),
    repo: AuthRepository = Depends(),
) -> dict:
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    sub = payload.get("sub")
    if sub is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    try:
        user_id = int(sub)
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token payload")
    user = await repo.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Account no longer exists")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    # Re-derive role/faculty from the live record so a token issued before a role change can't be reused.
    real_role = user.role.value
    payload["real_role"] = real_role
    payload["real_faculty_id"] = user.faculty_id

    # Impersonation: a super admin may carry act_as_* claims to operate as
    # another role. Only honoured while the underlying account is still a
    # super admin, so a demoted admin's token can't be replayed.
    act_as_role = payload.get("act_as_role")
    if act_as_role and real_role == RoleEnum.SUPER_ADMIN.value:
        payload["role"] = act_as_role
        payload["faculty_id"] = payload.get("act_as_faculty_id")
        payload["impersonating"] = True
        payload["impersonator_id"] = payload.get("impersonator_id") or payload.get("sub")
    else:
        payload["role"] = real_role
        payload["faculty_id"] = user.faculty_id
        payload["impersonating"] = False
    return payload

class RequireRole:
    def __init__(self, allowed_roles: list[str]):
        self.roles = allowed_roles

    def __call__(self, current_user: dict = Depends(get_current_user)):
        if current_user.get("role") not in self.roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return current_user


def require_real_super_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Authorize on the real (DB-derived) identity, ignoring any assumed role.

    Used by the impersonation endpoints so a super admin can start/switch/stop
    impersonation even while an assumed role is active.
    """
    if current_user.get("real_role") != RoleEnum.SUPER_ADMIN.value:
        raise HTTPException(status_code=403, detail="Only super admins can assume another role")
    return current_user
