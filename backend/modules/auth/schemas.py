import re

from pydantic import BaseModel, EmailStr, ConfigDict, Field, field_validator
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

class MsgResponse(BaseModel):
    message: str

class PasswordResetRequest(BaseModel):
    email: EmailStr

class PasswordResetVerify(BaseModel):
    is_valid: bool

class PasswordResetCodeCheck(BaseModel):
    """Check if reset code is valid (without resetting password)."""

    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)

    @field_validator("code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        """Validate code is 6 digits."""
        if not re.match(r"^\d{6}$", v):
            raise ValueError("Code must be exactly 6 digits")
        return v
    
class PasswordReset(BaseModel):
    """Verify reset code and set new password."""

    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8)

    @field_validator("code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        """Validate code is 6 digits."""
        if not re.match(r"^\d{6}$", v):
            raise ValueError("Code must be exactly 6 digits")
        return v

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        if not any(char.isdigit() for char in v):
            raise ValueError("Password must contain at least one digit")
        if not any(char.isupper() for char in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(char.islower() for char in v):
            raise ValueError("Password must contain at least one lowercase letter")
        return v