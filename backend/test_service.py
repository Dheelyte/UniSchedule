import asyncio
from core.database import async_session_maker
from modules.calendar.schemas import SessionCreate
from modules.calendar.repository import CalendarRepository
from modules.calendar.service import CalendarService

async def main():
    async with async_session_maker() as db:
        repo = CalendarRepository(db)
        service = CalendarService(repo)
        try:
            res = await service.create_session(SessionCreate(name="Testing Session", is_current=True))
            print("Session Created!", res.id)
            await db.commit()
        except Exception as e:
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
