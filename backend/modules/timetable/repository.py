from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from core.database import get_db
from modules.timetable.models import Faculty, Room, Course, ScheduleItem, Department

class TimetableRepository:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def create_faculty(self, faculty: Faculty) -> Faculty:
        self.db.add(faculty)
        await self.db.flush()
        return faculty

    async def get_faculties(self, faculty_id: str | None = None) -> list[Faculty]:
        query = select(Faculty)
        if faculty_id:
            query = query.where(Faculty.id == faculty_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_faculty(self, id: str) -> Faculty | None:
        result = await self.db.execute(select(Faculty).where(Faculty.id == id))
        return result.scalar_one_or_none()

    async def update_faculty(self, faculty: Faculty) -> Faculty:
        await self.db.flush()
        return faculty

    async def delete_faculty(self, faculty: Faculty) -> None:
        await self.db.delete(faculty)
        await self.db.flush()

    async def create_department(self, dept: Department) -> Department:
        self.db.add(dept)
        await self.db.flush()
        return dept

    async def get_departments(self, faculty_id: str | None = None) -> list[Department]:
        query = select(Department)
        if faculty_id:
            query = query.where(Department.faculty_id == faculty_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_department(self, id: int) -> Department | None:
        result = await self.db.execute(select(Department).where(Department.id == id))
        return result.scalar_one_or_none()

    async def update_department(self, dept: Department) -> Department:
        await self.db.flush()
        return dept

    async def delete_department(self, dept: Department) -> None:
        await self.db.delete(dept)
        await self.db.flush()

    async def create_room(self, room: Room) -> Room:
        self.db.add(room)
        await self.db.flush()
        return room

    async def get_rooms(self, faculty_id: str | None = None) -> list[Room]:
        query = select(Room)
        if faculty_id:
            query = query.where(Room.faculty_id == faculty_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_room(self, id: int) -> Room | None:
        result = await self.db.execute(select(Room).where(Room.id == id))
        return result.scalar_one_or_none()

    async def update_room(self, room: Room) -> Room:
        await self.db.flush()
        return room

    async def delete_room(self, room: Room) -> None:
        await self.db.delete(room)
        await self.db.flush()

    async def create_course(self, course: Course) -> Course:
        self.db.add(course)
        await self.db.flush()
        return course

    async def get_courses(self, faculty_id: str | None = None) -> list[Course]:
        if faculty_id:
            # Get department IDs for this faculty, then filter courses
            dept_result = await self.db.execute(select(Department.id).where(Department.faculty_id == faculty_id))
            dept_ids = [r for r in dept_result.scalars().all()]
            if not dept_ids:
                return []
            result = await self.db.execute(select(Course).where(Course.department_id.in_(dept_ids)))
        else:
            result = await self.db.execute(select(Course))
        return list(result.scalars().all())

    async def get_course(self, id: int) -> Course | None:
        result = await self.db.execute(select(Course).where(Course.id == id))
        return result.scalar_one_or_none()

    async def update_course(self, course: Course) -> Course:
        await self.db.flush()
        return course

    async def delete_course(self, course: Course) -> None:
        await self.db.delete(course)
        await self.db.flush()

    async def create_schedule_item(self, item: ScheduleItem) -> ScheduleItem:
        self.db.add(item)
        await self.db.flush()
        return item

    async def get_schedule_items(self, semester_id: int | None = None, faculty_id: str | None = None) -> list[ScheduleItem]:
        query = select(ScheduleItem)
        if semester_id is not None:
            query = query.where(ScheduleItem.semester_id == semester_id)
        if faculty_id is not None:
            query = query.where(ScheduleItem.faculty_id == faculty_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_schedule_item(self, id: int) -> ScheduleItem | None:
        result = await self.db.execute(select(ScheduleItem).where(ScheduleItem.id == id))
        return result.scalar_one_or_none()

    async def update_schedule_item(self, item: ScheduleItem) -> ScheduleItem:
        await self.db.flush()
        return item

    async def delete_schedule_item(self, item: ScheduleItem) -> None:
        await self.db.delete(item)
        await self.db.flush()
