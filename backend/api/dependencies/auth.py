from fastapi import Request, Depends, HTTPException
from core.security import decode_access_token
from modules.auth.repository import AuthRepository

async def get_token_from_cookie(request: Request) -> str:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return token

async def get_current_user(token: str = Depends(get_token_from_cookie)) -> dict:
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload

class RequireRole:
    def __init__(self, allowed_roles: list[str]):
        self.roles = allowed_roles
        
    def __call__(self, current_user: dict = Depends(get_current_user)):
        if current_user.get("role") not in self.roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return current_user
