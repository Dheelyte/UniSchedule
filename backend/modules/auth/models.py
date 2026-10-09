import enum
from datetime import datetime
from sqlalchemy import String, Boolean, Enum, DateTime, ForeignKey, null
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from core.base_model import Base

class RoleEnum(str, enum.Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    SUPER_VIEWER = "SUPER_VIEWER"
    FACULTY_EDITOR = "FACULTY_EDITOR"
    FACULTY_VIEWER = "FACULTY_VIEWER"
    GS_ADMIN = "GS_ADMIN"
    CITS_ADMIN = "CITS_ADMIN"


# These roles choose a realm at login and can switch; every other role belongs
# to exactly one realm. Unrelated to _has_global_scope, which is about faculties.
CROSS_REALM_ROLES = frozenset({RoleEnum.SUPER_ADMIN, RoleEnum.SUPER_VIEWER, RoleEnum.CITS_ADMIN})


def stored_realm_key(role: RoleEnum, realm_key: str | None):
    """The `realm_key` to store on a new user or invitation with this role.

    Cross-realm roles get an explicit SQL NULL: a Python None would be left out
    of the INSERT and the column's 'UG' server default would apply instead.
    """
    return null() if role in CROSS_REALM_ROLES else realm_key


class User(Base):
    __tablename__ = "users"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String)
    role: Mapped[RoleEnum] = mapped_column(Enum(RoleEnum))
    faculty_id: Mapped[str | None] = mapped_column(String, nullable=True)
    semester_id: Mapped[int | None] = mapped_column(ForeignKey("semesters.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # NULL for cross-realm roles (set explicitly in code).
    realm_key: Mapped[str | None] = mapped_column(ForeignKey("realms.key"), nullable=True, server_default="UG", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Invitation(Base):
    __tablename__ = "invitations"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, index=True)
    token: Mapped[str] = mapped_column(String, unique=True, index=True)
    target_role: Mapped[RoleEnum] = mapped_column(Enum(RoleEnum))
    faculty_id: Mapped[str | None] = mapped_column(String, nullable=True)
    semester_id: Mapped[int | None] = mapped_column(ForeignKey("semesters.id"), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_used: Mapped[bool] = mapped_column(Boolean, default=False)
    # NULL for cross-realm roles (set explicitly in code).
    realm_key: Mapped[str | None] = mapped_column(ForeignKey("realms.key"), nullable=True, server_default="UG", index=True)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    is_used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user = relationship("User", lazy="joined")
