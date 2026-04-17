from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/unilag_timetable"
    SECRET_KEY: str = "super_secret_key_change_in_production"
    FRONTEND_URL: str = "http://127.0.0.1:3000"
    DEFAULT_SUPER_ADMIN_EMAIL: str = ""
    DEFAULT_SUPER_ADMIN_PASSWORD: str = ""

    #Authentication
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "none"

    CORS_ALLOWED_ORIGINS: list[str] = []

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding='utf-8', extra='ignore')

settings = Settings()
