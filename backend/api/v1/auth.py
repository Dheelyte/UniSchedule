from fastapi import APIRouter, Depends, Response, HTTPException, status
from core.security import verify_password
from modules.auth.service import AuthService, PasswordResetService
from modules.auth.schemas import LoginRequest, InviteRequest, MsgResponse, PasswordReset, PasswordResetCodeCheck, PasswordResetRequest, PasswordResetVerify, RegisterRequest, UserResponse, InvitationResponse, ImpersonateRequest
from core.config import settings
from api.dependencies.auth import RequireRole, get_current_user, require_real_super_admin
from modules.auth.models import RoleEnum
from modules.timetable.repository import TimetableRepository
from core.mail import EmailService

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

def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=1440 * 60,
    )

@router.post("/impersonate")
async def impersonate(
    response: Response,
    data: ImpersonateRequest,
    service: AuthService = Depends(),
    current_user: dict = Depends(require_real_super_admin),
):
    token = await service.impersonate(current_user, data.role, data.faculty_id)
    _set_session_cookie(response, token)
    return {"message": f"Now acting as {data.role.value}"}

@router.post("/impersonate/stop")
async def stop_impersonation(
    response: Response,
    service: AuthService = Depends(),
    current_user: dict = Depends(require_real_super_admin),
):
    token = await service.stop_impersonation(current_user)
    _set_session_cookie(response, token)
    return {"message": "Stopped impersonating"}

@router.post("/invite")
async def invite_staff(
    data: InviteRequest, 
    service: AuthService = Depends(),
    timetable_repo: TimetableRepository = Depends(),
    current_user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))
):
    invite = await service.generate_invite(data.email, data.target_role, data.faculty_id, data.semester_id, current_user)
    
    faculty_name = None
    if data.faculty_id:
        faculty = await timetable_repo.get_faculty(data.faculty_id)
        if faculty:
            faculty_name = faculty.name
            
    await EmailService.send_invitation_email(
        recipient_email=data.email, 
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
async def get_users(service: AuthService = Depends(), user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.SUPER_VIEWER.value]))):
    return await service.get_all_users()

@router.get("/invitations", response_model=list[InvitationResponse])
async def get_invitations(service: AuthService = Depends(), user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.SUPER_VIEWER.value]))):
    return await service.get_all_invitations()

@router.delete("/users/{user_id}")
async def delete_user(user_id: int, service: AuthService = Depends(), user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))):
    if str(user_id) == str(user.get("sub", "")):
        raise HTTPException(status_code=400, detail="You cannot revoke your own active tracking session.")
    if not await service.delete_user(user_id, user):
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted"}

@router.delete("/invitations/{inv_id}")
async def delete_invitation(inv_id: int, service: AuthService = Depends(), user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))):
    if not await service.delete_invitation(inv_id, user):
        raise HTTPException(status_code=404, detail="Invitation not found")
    return {"message": "Invitation deleted"}


@router.post(
    "/request-password-reset",
    status_code=status.HTTP_200_OK,
    response_model=MsgResponse,
)
async def request_password_reset(
    request_data: PasswordResetRequest,
    auth_service:  AuthService = Depends(),
    password_reset_service: PasswordResetService = Depends(),
):
    """
    Request a password reset for a user.

    This endpoint accepts an email address and, if the user exists, generates a
    password reset code and sends a reset email. For security reasons, the
    response does not reveal whether the email belongs to a registered user,
    preventing account enumeration.

    **Flow:**
    1. Look up the user by email.
    2. If the user exists:
       - Generate a password reset code.
       - Send a reset email containing the code.
    3. Always return a generic success message.

    **Security Note:**
    The same response is returned whether or not the email exists to protect
    against user enumeration attacks.

    **Returns:**
    - A message indicating that a reset email will be sent if the account exists.
    """

    user = await auth_service.get_user_by_email(email=request_data.email)
    if user:
        code = await password_reset_service.create_reset_code(user)
        await password_reset_service.send_password_reset_email(user=user, code=code)
    # Always return success to prevent email enumeration
    return MsgResponse(
        message="If the email exists, a password reset code has been sent"
    )


@router.post(
    "/verify-reset-code",
    status_code=status.HTTP_200_OK,
    response_model=PasswordResetVerify,
)
async def verify_reset_code(
    verify_data: PasswordResetCodeCheck, password_reset_service: PasswordResetService = Depends()
):
    """
    Verify a password reset code before allowing the user to proceed.

    This endpoint checks whether the submitted reset code is valid and has not
    expired for the specified email address. It is typically called by the UI
    before showing the "Enter new password" screen, ensuring the token is still
    usable.

    **Flow:**
    1. Extract email and reset code from the request.
    2. Validate the code against the database.
    3. If valid, return a success response.
    4. If invalid or expired, return a `400 Bad Request` error.

    **Returns:**
    - `{ "is_valid": true }` if the reset code is valid.
    - `400 Bad Request` if the reset code is invalid or expired.
    """

    valid_token = await password_reset_service.verify_reset_code(
        code=verify_data.code, email=verify_data.email
    )
    print(valid_token)
    if not valid_token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired code")
    return PasswordResetVerify(is_valid=True)


@router.post("/reset-password", response_model=MsgResponse)
async def reset_password(
    reset_data: PasswordReset, password_reset_service: PasswordResetService = Depends()
):
    """
    Reset a user's password using a valid reset code.

    This endpoint accepts an email, reset code, and new password. It ensures the
    reset token is valid, not expired, and corresponds to the correct user before
    updating the password. It also prevents the user from reusing their old
    password.

    **Flow:**
    1. Validate the email + code combination.
    2. Ensure the reset code is still active and not expired.
    3. Prevent password reuse by checking against the old password hash.
    4. Update the user's password and invalidate the reset token.

    **Error Responses:**
    - `400 Bad Request` — Invalid or expired reset code.
    - `400 Bad Request` — New password matches the old password.

    **Returns:**
    - A success message once the password has been updated.
    """

    valid_token = await password_reset_service.verify_reset_code(
        code=reset_data.code, email=reset_data.email
    )
    if not valid_token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired code")

    if verify_password(
        plain_password=reset_data.new_password, hashed_password=valid_token.user.hashed_password
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "New password must not be the same with the old one",
        )

    await password_reset_service.reset_password_with_token(
        token_obj=valid_token, new_password=reset_data.new_password
    )
    return MsgResponse(message="Password reset successfully")
