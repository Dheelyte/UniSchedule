from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    # --- Infrastructure & Environment ---
    ENVIRONMENT: str = Field(
        default="dev",
        pattern="^(dev|staging|prod)$",
        description="Deployment environment filter"
    )
    DEBUG: bool = Field(default=True)

    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/unilag_timetable"
    
    SECRET_KEY: str = Field(..., min_length=32)
    ALGORITHM: str = Field(default="HS256")
    
    FRONTEND_URL: str = "http://127.0.0.1:3000"

    DEFAULT_SUPER_ADMIN_EMAIL: str = ""
    DEFAULT_SUPER_ADMIN_PASSWORD: str = ""

    #Authentication
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"

    PASSWORD_RESET_CODE_EXPIRE_MINUTES: int = Field(default=10)

    CORS_ALLOWED_ORIGINS: list[str] = ["http://127.0.0.1:3000", "http://localhost:3000"]

    # --- Email Configuration ---
    MAIL_USERNAME: str = Field(default="test")
    MAIL_PASSWORD: str = Field(default="test")
    MAIL_FROM: str = Field(default="test@email.com")
    MAIL_PORT: int = Field(default=587)
    MAIL_SERVER: str = Field(default="dev")
    MAIL_STARTTLS: bool = Field(default=False)
    MAIL_SSL_TLS: bool = Field(default=True)
    USE_CREDENTIALS: bool = Field(default=True)
    VALIDATE_CERTS: bool = Field(default=True)
    TEMPLATE_FOLDER: str = Field(default="templates")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding='utf-8', extra='ignore')

settings = Settings()
