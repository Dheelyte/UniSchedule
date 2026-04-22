from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import date
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
        query = query.order_by(Room.display_order.asc(), Room.name.asc())
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
            from sqlalchemy import or_
            from modules.timetable.models import CourseScope
            dept_result = await self.db.execute(select(Department.id).where(Department.faculty_id == faculty_id))
            dept_ids = [r for r in dept_result.scalars().all()]
            conditions = [Course.scope.in_([CourseScope.INTERFACULTY, CourseScope.UNIVERSITY_WIDE])]
            if dept_ids:
                conditions.append(Course.department_id.in_(dept_ids))
            query = select(Course).where(or_(*conditions))
            result = await self.db.execute(query)
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

    # ---------- Blocked Slots ----------

    async def create_blocked_slot(self, slot: 'BlockedSlot') -> 'BlockedSlot':
        self.db.add(slot)
        await self.db.flush()
        return slot

    async def get_blocked_slots(self, semester_id: int | None = None) -> list['BlockedSlot']:
        from modules.timetable.models import BlockedSlot
        query = select(BlockedSlot)
        if semester_id:
            query = query.where(BlockedSlot.semester_id == semester_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_relevant_blocked_slots(self, semester_id: int, day_of_week: str | None = None, exact_date: date | None = None) -> list['BlockedSlot']:
        from modules.timetable.models import BlockedSlot
        from sqlalchemy import or_
        
        conditions = [BlockedSlot.semester_id == semester_id]
        or_conditions = []
        if day_of_week:
            or_conditions.append(BlockedSlot.day_of_week == day_of_week)
        if exact_date:
            or_conditions.append(BlockedSlot.date == exact_date)
            
        if not or_conditions:
            return []
        
        conditions.append(or_(*or_conditions))
        
        result = await self.db.execute(select(BlockedSlot).where(*conditions))
        return list(result.scalars().all())

    async def delete_blocked_slot(self, slot: 'BlockedSlot') -> None:
        await self.db.delete(slot)
        await self.db.flush()

    async def get_blocked_slot(self, id: int) -> 'BlockedSlot | None':
        from modules.timetable.models import BlockedSlot
        result = await self.db.execute(select(BlockedSlot).where(BlockedSlot.id == id))
        return result.scalar_one_or_none()
