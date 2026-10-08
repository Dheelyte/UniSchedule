from fastapi import Request, Depends, HTTPException
from core.security import decode_access_token
from modules.auth.repository import AuthRepository
from modules.auth.models import RoleEnum, CROSS_REALM_ROLES
from modules.realms.defaults import DEFAULT_REALM_KEY
from modules.realms.repository import RealmRepository
from modules.realms.schemas import RealmConfig

async def get_token_from_cookie(request: Request) -> str:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return token

async def get_current_user(
    request: Request,
    token: str = Depends(get_token_from_cookie),
    repo: AuthRepository = Depends(),
    realm_repo: RealmRepository = Depends(),
) -> dict:
    # Resolved once per request.
    cached = getattr(request.state, "current_user", None)
    if cached is not None:
        return cached
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

    # Realm: re-derived like the role. A realm-bound account always works in its
    # own realm, whatever the token says; a cross-realm account (judged by the
    # real role, so impersonation keeps the realm) works in the one it chose.
    if user.role in CROSS_REALM_ROLES:
        realm_key = payload.get("realm") or DEFAULT_REALM_KEY
    else:
        realm_key = user.realm_key or DEFAULT_REALM_KEY
    realm = await realm_repo.get_realm(realm_key)
    if not realm:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    payload["realm"] = realm.key
    payload["realm_name"] = realm.name
    payload["realm_config"] = RealmConfig.model_validate(realm.config).model_dump()
    request.state.current_user = payload
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
