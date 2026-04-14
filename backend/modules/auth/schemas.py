from pydantic import BaseModel, EmailStr, ConfigDict
from datetime import datetime
from modules.auth.models import RoleEnum

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class InviteRequest(BaseModel):
    email: EmailStr
    target_role: RoleEnum
    faculty_id: str | None = None
    semester_id: int | None = None

class RegisterRequest(BaseModel):
    password: str

class UserResponse(BaseModel):
    id: int
    email: EmailStr
    role: RoleEnum
    faculty_id: str | None
    semester_id: int | None
    is_active: bool
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class InvitationResponse(BaseModel):
    id: int
    email: EmailStr
    token: str
    target_role: RoleEnum
    faculty_id: str | None
    semester_id: int | None
    expires_at: datetime
    is_used: bool
    model_config = ConfigDict(from_attributes=True)
