from fastapi import APIRouter, Depends, Response, HTTPException
from modules.auth.service import AuthService
from modules.auth.schemas import LoginRequest, InviteRequest, RegisterRequest, UserResponse, InvitationResponse
from core.config import settings
from api.dependencies.auth import RequireRole, get_current_user
from modules.auth.models import RoleEnum
from modules.timetable.repository import TimetableRepository
from core.mail import send_invitation_email

router = APIRouter(prefix="/auth", tags=["Auth"])

@router.post("/login")
async def login(response: Response, data: LoginRequest, service: AuthService = Depends()):
    token = await service.authenticate_user(data.email, data.password)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=1440 * 60
    )
    return {"message": "Login successful"}

@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(key="access_token")
    return {"message": "Logout successful"}

@router.get("/me")
async def get_current_session(user: dict = Depends(get_current_user)):
    return user

@router.post("/invite")
async def invite_staff(
    data: InviteRequest, 
    service: AuthService = Depends(),
    timetable_repo: TimetableRepository = Depends(),
    current_user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))
):
    invite = await service.generate_invite(data.email, data.target_role, data.faculty_id, data.semester_id)
    
    faculty_name = None
    if data.faculty_id:
        faculty = await timetable_repo.get_faculty(data.faculty_id)
        if faculty:
            faculty_name = faculty.name
            
    await send_invitation_email(
        to_email=data.email, 
        token=invite.token, 
        role=data.target_role.value, 
        faculty_name=faculty_name
    )
    return {"message": "Invitation created", "token": invite.token}

@router.post("/register/{token}")
async def complete_registration(
    token: str, 
    data: RegisterRequest, 
    service: AuthService = Depends()
):
    user = await service.process_invitation(token, data.password)
    return {"message": "Registration successful", "user_id": user.id}

@router.get("/users", response_model=list[UserResponse])
async def get_users(service: AuthService = Depends(), user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))):
    return await service.get_all_users()

@router.get("/invitations", response_model=list[InvitationResponse])
async def get_invitations(service: AuthService = Depends(), user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))):
    return await service.get_all_invitations()

@router.delete("/users/{user_id}")
async def delete_user(user_id: int, service: AuthService = Depends(), user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))):
    if str(user_id) == str(user.get("sub", "")):
        raise HTTPException(status_code=400, detail="You cannot revoke your own active tracking session.")
    if not await service.delete_user(user_id):
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted"}

@router.delete("/invitations/{inv_id}")
async def delete_invitation(inv_id: int, service: AuthService = Depends(), user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))):
    if not await service.delete_invitation(inv_id):
        raise HTTPException(status_code=404, detail="Invitation not found")
    return {"message": "Invitation deleted"}
