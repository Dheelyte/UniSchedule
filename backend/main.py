import contextlib
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from core.config import settings
from core.database import get_db, async_session_maker
from api.v1 import dummy, auth, calendar, timetable, export, notifications
from modules.auth.models import User, RoleEnum
from core.security import get_password_hash

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed default super admin if none exists
    async with async_session_maker() as session:
        result = await session.execute(select(User).where(User.role == RoleEnum.SUPER_ADMIN))
        super_admin = result.scalars().first()
        if not super_admin:
            new_admin = User(
                email=settings.DEFAULT_SUPER_ADMIN_EMAIL,
                hashed_password=get_password_hash(settings.DEFAULT_SUPER_ADMIN_PASSWORD),
                role=RoleEnum.SUPER_ADMIN,
                is_active=True
            )
            session.add(new_admin)
            await session.commit()
    yield

app = FastAPI(title="UniSchedule API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dummy.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(calendar.router, prefix="/api/v1")
app.include_router(timetable.router, prefix="/api/v1")
app.include_router(export.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")

@app.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    # Verify Unit of Work runs without throwing errors
    return {"status": "ok", "message": "Database session injected successfully"}
