from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, any_
from datetime import date, datetime, timezone
from core.database import get_db
from modules.timetable.models import Faculty, Room, Course, ScheduleItem, Department, TimetableLock, CourseEnrollment, ChangeRequest, ConflictDismissal

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

    async def get_rooms_by_ids(self, ids: list[int]) -> list[Room]:
        if not ids:
            return []
        result = await self.db.execute(select(Room).where(Room.id.in_(ids)))
        return list(result.scalars().all())

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

    async def is_course_referenced_by_schedule(self, course_id: int) -> bool:
        from modules.timetable.models import ScheduleItem
        query = select(ScheduleItem.id).where(ScheduleItem.course_id == course_id).limit(1)
        result = await self.db.execute(query)
        return result.scalar() is not None

    async def is_room_referenced_by_schedule(self, room_id: int) -> bool:
        from modules.timetable.models import ScheduleItem
        from sqlalchemy import func
        query = select(ScheduleItem.id).where(room_id == any_(ScheduleItem.room_ids)).limit(1)
        result = await self.db.execute(query)
        return result.scalar() is not None

    async def create_schedule_item(self, item: ScheduleItem) -> ScheduleItem:
        self.db.add(item)
        await self.db.flush()
        return item

    async def get_schedule_items(self, semester_id: int | None = None, faculty_id: str | None = None) -> list[ScheduleItem]:
        query = select(ScheduleItem)
        if semester_id is not None:
            query = query.where(ScheduleItem.semester_id == semester_id)
        if faculty_id is not None:
            enrolled_subq = (
                select(CourseEnrollment.course_id)
                .join(Department, Department.id == CourseEnrollment.department_id)
                .where(Department.faculty_id == faculty_id)
            )
            query = query.where(or_(
                ScheduleItem.faculty_id == faculty_id,
                ScheduleItem.course_id.in_(enrolled_subq),
            ))
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

    async def get_schedule_items_by_ids(self, ids: list[int]) -> list[ScheduleItem]:
        if not ids:
            return []
        result = await self.db.execute(select(ScheduleItem).where(ScheduleItem.id.in_(ids)))
        return list(result.scalars().all())

    # ---------- Conflict Dismissals ----------

    async def create_dismissal(self, dismissal: ConflictDismissal) -> ConflictDismissal:
        self.db.add(dismissal)
        await self.db.flush()
        return dismissal

    async def get_dismissals(self) -> list[ConflictDismissal]:
        result = await self.db.execute(
            select(ConflictDismissal).order_by(ConflictDismissal.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_dismissal(self, id: int) -> ConflictDismissal | None:
        result = await self.db.execute(select(ConflictDismissal).where(ConflictDismissal.id == id))
        return result.scalar_one_or_none()

    async def find_dismissal(self, conflict_type: str, item_a_id: int, item_b_id: int | None) -> ConflictDismissal | None:
        query = select(ConflictDismissal).where(
            ConflictDismissal.conflict_type == conflict_type,
            ConflictDismissal.item_a_id == item_a_id,
        )
        if item_b_id is None:
            query = query.where(ConflictDismissal.item_b_id.is_(None))
        else:
            query = query.where(ConflictDismissal.item_b_id == item_b_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def delete_dismissal(self, dismissal: ConflictDismissal) -> None:
        await self.db.delete(dismissal)
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

    # ---------- Timetable Locks ----------

    async def get_lock(self, semester_id: int, timetable_type: str) -> TimetableLock | None:
        result = await self.db.execute(
            select(TimetableLock).where(
                TimetableLock.semester_id == semester_id,
                TimetableLock.timetable_type == timetable_type,
            )
        )
        return result.scalar_one_or_none()

    async def list_locks(self, semester_id: int) -> list[TimetableLock]:
        result = await self.db.execute(
            select(TimetableLock).where(TimetableLock.semester_id == semester_id)
        )
        return list(result.scalars().all())

    async def upsert_lock(self, semester_id: int, timetable_type: str, is_locked: bool, user_id: int | None) -> TimetableLock:
        lock = await self.get_lock(semester_id, timetable_type)
        now = datetime.now(timezone.utc) if is_locked else None
        actor = user_id if is_locked else None
        if lock is None:
            lock = TimetableLock(
                semester_id=semester_id,
                timetable_type=timetable_type,
                is_locked=is_locked,
                locked_by=actor,
                locked_at=now,
            )
            self.db.add(lock)
        else:
            lock.is_locked = is_locked
            lock.locked_by = actor
            lock.locked_at = now
        await self.db.flush()
        return lock

    # ---------- Course Enrollments (per dept × level) ----------

    async def list_enrollments(
        self,
        faculty_id: str | None = None,
        course_id: int | None = None,
        department_id: int | None = None,
    ) -> list[CourseEnrollment]:
        query = select(CourseEnrollment)
        if course_id is not None:
            query = query.where(CourseEnrollment.course_id == course_id)
        if department_id is not None:
            query = query.where(CourseEnrollment.department_id == department_id)
        if faculty_id is not None:
            query = query.join(Department, Department.id == CourseEnrollment.department_id).where(
                Department.faculty_id == faculty_id
            )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_enrollment(self, course_id: int, department_id: int, level: int) -> CourseEnrollment | None:
        result = await self.db.execute(
            select(CourseEnrollment).where(
                CourseEnrollment.course_id == course_id,
                CourseEnrollment.department_id == department_id,
                CourseEnrollment.level == level,
            )
        )
        return result.scalar_one_or_none()

    async def create_enrollment(self, enrollment: CourseEnrollment) -> CourseEnrollment:
        self.db.add(enrollment)
        await self.db.flush()
        return enrollment

    async def delete_enrollment(self, enrollment: CourseEnrollment) -> None:
        await self.db.delete(enrollment)
        await self.db.flush()

    # ---------- Change Requests ----------

    async def create_change_request(self, request: ChangeRequest) -> ChangeRequest:
        self.db.add(request)
        await self.db.flush()
        return request

    async def get_change_request(self, id: int) -> ChangeRequest | None:
        result = await self.db.execute(select(ChangeRequest).where(ChangeRequest.id == id))
        return result.scalar_one_or_none()

    async def list_change_requests(
        self,
        semester_id: int | None = None,
        timetable_type: str | None = None,
        status: str | None = None,
        requested_by: int | None = None,
    ) -> list[ChangeRequest]:
        query = select(ChangeRequest)
        if semester_id is not None:
            query = query.where(ChangeRequest.semester_id == semester_id)
        if timetable_type is not None:
            query = query.where(ChangeRequest.timetable_type == timetable_type)
        if status is not None:
            query = query.where(ChangeRequest.status == status)
        if requested_by is not None:
            query = query.where(ChangeRequest.requested_by == requested_by)
        query = query.order_by(ChangeRequest.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_change_request(self, request: ChangeRequest) -> ChangeRequest:
        await self.db.flush()
        return request
