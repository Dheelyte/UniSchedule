from fastapi import Depends, HTTPException
from datetime import date
from modules.timetable.repository import TimetableRepository
from modules.calendar.repository import CalendarRepository
from modules.timetable.models import Faculty, Room, Course, ScheduleItem, Department, CourseScope, BlockedSlot
from modules.timetable.schemas import (
    FacultyCreate, RoomCreate, CourseCreate, ScheduleItemCreate, DepartmentCreate, ScheduleItemUpdate,
    FacultyUpdate, DepartmentUpdate, RoomUpdate, CourseUpdate, BlockedSlotCreate, RoomReorderRequest
)
from modules.auth.models import RoleEnum
from sqlalchemy.exc import IntegrityError

class TimetableService:
    def __init__(self, repo: TimetableRepository = Depends(), cal_repo: CalendarRepository = Depends()):
        self.repo = repo
        self.cal_repo = cal_repo
        
    async def create_faculty(self, data: FacultyCreate) -> Faculty:
        faculty = Faculty(id=data.id, name=data.name)
        return await self.repo.create_faculty(faculty)

    async def get_faculties(self, current_user: dict) -> list[Faculty]:
        faculty_id = None if current_user.get('role') == RoleEnum.SUPER_ADMIN.value else current_user.get('faculty_id')
        return await self.repo.get_faculties(faculty_id=faculty_id)

    async def update_faculty(self, id: str, data: FacultyUpdate, current_user: dict) -> Faculty:
        if current_user.get("role") != RoleEnum.SUPER_ADMIN.value:
            raise HTTPException(status_code=403, detail="Not authorized")
        faculty = await self.repo.get_faculty(id)
        if not faculty: raise HTTPException(status_code=404, detail="Faculty not found")
        if data.name is not None: faculty.name = data.name
        return await self.repo.update_faculty(faculty)

    async def delete_faculty(self, id: str, current_user: dict) -> None:
        if current_user.get("role") != RoleEnum.SUPER_ADMIN.value:
            raise HTTPException(status_code=403, detail="Not authorized")
        faculty = await self.repo.get_faculty(id)
        if faculty: 
            try:
                await self.repo.delete_faculty(faculty)
            except IntegrityError:
                raise HTTPException(status_code=400, detail="Cannot delete faculty because it is currently referenced by other records (such as departments or schedule items). Please remove them first.")

    async def create_department(self, data: DepartmentCreate, current_user: dict) -> Department:
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != data.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
        dept = Department(name=data.name, faculty_id=data.faculty_id)
        return await self.repo.create_department(dept)

    async def get_departments(self, current_user: dict) -> list[Department]:
        faculty_id = None if current_user.get('role') == RoleEnum.SUPER_ADMIN.value else current_user.get('faculty_id')
        return await self.repo.get_departments(faculty_id=faculty_id)

    async def update_department(self, id: int, data: DepartmentUpdate, current_user: dict) -> Department:
        dept = await self.repo.get_department(id)
        if not dept: raise HTTPException(status_code=404, detail="Not found")
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != dept.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
        if data.name is not None: dept.name = data.name
        if data.faculty_id is not None:
            if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value and current_user.get("faculty_id") != data.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
            dept.faculty_id = data.faculty_id
        return await self.repo.update_department(dept)

    async def delete_department(self, id: int, current_user: dict) -> None:
        dept = await self.repo.get_department(id)
        if not dept: return
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != dept.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
        try:
            await self.repo.delete_department(dept)
        except IntegrityError:
            raise HTTPException(status_code=400, detail="Cannot delete department because it is currently referenced by other records (such as courses). Please remove them first.")

    async def create_room(self, data: RoomCreate, current_user: dict) -> Room:
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != data.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized to bind this resource off-scope")
        room = Room(name=data.name, capacity=data.capacity, faculty_id=data.faculty_id)
        try:
            return await self.repo.create_room(room)
        except IntegrityError:
            raise HTTPException(status_code=400, detail=f"Room '{data.name}' already exists.")

    async def get_rooms(self, current_user: dict) -> list[Room]:
        faculty_id = None if current_user.get('role') == RoleEnum.SUPER_ADMIN.value else current_user.get('faculty_id')
        return await self.repo.get_rooms(faculty_id=faculty_id)

    async def update_room(self, id: int, data: RoomUpdate, current_user: dict) -> Room:
        room = await self.repo.get_room(id)
        if not room: raise HTTPException(status_code=404, detail="Not found")
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != room.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
        if data.name is not None: room.name = data.name
        if data.capacity is not None: room.capacity = data.capacity
        if data.faculty_id is not None:
            if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value and current_user.get("faculty_id") != data.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
            room.faculty_id = data.faculty_id
        try:
            return await self.repo.update_room(room)
        except IntegrityError:
            raise HTTPException(status_code=400, detail=f"Room name must be unique.")

    async def delete_room(self, id: int, current_user: dict) -> None:
        room = await self.repo.get_room(id)
        if not room: return
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != room.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
        try:
            await self.repo.delete_room(room)
        except IntegrityError:
            raise HTTPException(status_code=400, detail="Cannot delete room because it is currently referenced by other records (such as schedule items). Please remove them first.")

    async def reorder_rooms(self, data: RoomReorderRequest, current_user: dict) -> list[Room]:
        if current_user.get("role") not in [RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        # Build map for fast updates
        order_map = {item.id: item.display_order for item in data.rooms}
        updated_rooms = []
        
        for room_id, new_order in order_map.items():
            room = await self.repo.get_room(room_id)
            if room:
                if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value and current_user.get("faculty_id") != room.faculty_id:
                    continue # Skip rooms outside their faculty natively
                room.display_order = new_order
                updated_rooms.append(room)
                
        await self.repo.db.flush()
        return updated_rooms

    async def create_course(self, data: CourseCreate, current_user: dict) -> Course:
        # Only Super Admins can create university-wide courses
        if data.scope == CourseScope.UNIVERSITY_WIDE.value:
            if current_user.get("role") != RoleEnum.SUPER_ADMIN.value:
                raise HTTPException(status_code=403, detail="Only Super Admins can create university-wide courses")
        course = Course(
            code=data.code, 
            title=data.title, 
            credit_load=data.credit_load,
            lecturers=data.lecturers,
            department_id=data.department_id,
            scope=data.scope
        )
        try:
            return await self.repo.create_course(course)
        except IntegrityError:
            raise HTTPException(status_code=400, detail=f"Course code '{data.code}' already exists.")

    async def get_courses(self, current_user: dict) -> list[Course]:
        faculty_id = None if current_user.get('role') == RoleEnum.SUPER_ADMIN.value else current_user.get('faculty_id')
        return await self.repo.get_courses(faculty_id=faculty_id)

    async def update_course(self, id: int, data: CourseUpdate, current_user: dict) -> Course:
        course = await self.repo.get_course(id)
        if not course: raise HTTPException(status_code=404, detail="Not found")
        # Only Super Admins can set scope to UNIVERSITY_WIDE
        if data.scope == CourseScope.UNIVERSITY_WIDE.value:
            if current_user.get("role") != RoleEnum.SUPER_ADMIN.value:
                raise HTTPException(status_code=403, detail="Only Super Admins can set university-wide scope")
        if data.code is not None: course.code = data.code
        if data.title is not None: course.title = data.title
        if data.credit_load is not None: course.credit_load = data.credit_load
        if data.lecturers is not None: course.lecturers = data.lecturers
        if data.scope is not None:
            course.scope = data.scope
            # Clear department_id if switching to UNIVERSITY_WIDE
            if data.scope == CourseScope.UNIVERSITY_WIDE.value:
                course.department_id = None
        if data.department_id is not None: course.department_id = data.department_id
        try:
            return await self.repo.update_course(course)
        except IntegrityError:
            raise HTTPException(status_code=400, detail="A course with this code already exists.")

    async def delete_course(self, id: int, current_user: dict) -> None:
        course = await self.repo.get_course(id)
        if course:
            try:
                await self.repo.delete_course(course)
            except IntegrityError:
                raise HTTPException(status_code=400, detail="Cannot delete course because it is currently referenced by schedule items. Please remove them first.")

    async def _check_blocked_slots(self, item_type: str, day_of_week: str | None, exam_date: date | None, start_time, end_time, semester_id: int):
        """Raise HTTPException if the proposed time overlaps any blocked slot."""
        if item_type == "exam" and exam_date:
            day_of_week = exam_date.strftime("%A")
            
        blocked = await self.repo.get_relevant_blocked_slots(semester_id, day_of_week, exam_date)
        for slot in blocked:
            # Check applies_to scope
            scope = getattr(slot, 'applies_to', 'BOTH')
            scope_val = scope.value if hasattr(scope, 'value') else str(scope)
            if item_type == "lecture" and scope_val == "EXAM_ONLY":
                continue
            if item_type == "exam" and scope_val == "LECTURE_ONLY":
                continue

            # All blocked slots now have time ranges — check overlap
            if slot.start_time and slot.end_time:
                match_day = False
                if slot.date and exam_date:
                    match_day = slot.date == exam_date
                elif slot.day_of_week and day_of_week:
                    match_day = slot.day_of_week == day_of_week
                
                if match_day and start_time < slot.end_time and end_time > slot.start_time:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Time conflict with blocked slot '{slot.name}' ({slot.start_time.strftime('%H:%M')}–{slot.end_time.strftime('%H:%M')})"
                    )

    async def create_schedule_item(self, data: ScheduleItemCreate, current_user: dict) -> ScheduleItem:
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != data.faculty_id:
                raise HTTPException(status_code=403, detail="Strictly forbidden to schedule outside assigned faculty")

        # Verify schedule targets the current semester
        current_sem = await self.cal_repo.get_current_semester()
        if not current_sem:
            raise HTTPException(status_code=400, detail="No active semester found. Please create a current semester before scheduling.")
        if data.semester_id is not None and data.semester_id != current_sem.id:
            raise HTTPException(status_code=403, detail="You can only schedule courses for the current semester.")

        sem_id = data.semester_id or current_sem.id
        exam_date_val = getattr(data, 'exam_date', None)
        await self._check_blocked_slots(data.type, data.day_of_week, exam_date_val, data.start_time, data.end_time, sem_id)
        
        item = ScheduleItem(
            course_id=data.course_id,
            room_ids=data.room_ids,
            faculty_id=data.faculty_id,
            day_of_week=data.day_of_week,
            start_time=data.start_time,
            end_time=data.end_time,
            type=data.type,
            week=data.week,
            exam_date=getattr(data, 'exam_date', None),
            semester_id=data.semester_id
        )
        return await self.repo.create_schedule_item(item)

    async def get_schedule_items(self, current_user: dict, semester_id: int | None = None) -> list[ScheduleItem]:
        faculty_id = None if current_user.get('role') == RoleEnum.SUPER_ADMIN.value else current_user.get('faculty_id')
        return await self.repo.get_schedule_items(semester_id=semester_id, faculty_id=faculty_id)
        
    async def update_schedule_item(self, id: int, data: ScheduleItemUpdate, current_user: dict) -> ScheduleItem:
        item = await self.repo.get_schedule_item(id)
        if not item:
            raise HTTPException(status_code=404, detail="Schedule missing")
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != item.faculty_id:
                raise HTTPException(status_code=403, detail="Forbidden update")
        # Check blocked slots if day or time is changing
        new_day = data.day_of_week if data.day_of_week is not None else item.day_of_week
        new_exam_date = getattr(data, 'exam_date', None) if getattr(data, 'exam_date', None) is not None else getattr(item, 'exam_date', None)
        new_start = data.start_time or item.start_time
        new_end = data.end_time or item.end_time
        if item.semester_id:
            await self._check_blocked_slots(item.type, new_day, new_exam_date, new_start, new_end, item.semester_id)
        if data.room_ids is not None: item.room_ids = data.room_ids
        if data.day_of_week is not None: item.day_of_week = data.day_of_week
        if data.exam_date is not None: item.exam_date = data.exam_date
        if data.start_time is not None: item.start_time = data.start_time
        if data.end_time is not None: item.end_time = data.end_time
        return await self.repo.update_schedule_item(item)

    async def delete_schedule_item(self, id: int, current_user: dict) -> None:
        item = await self.repo.get_schedule_item(id)
        if not item: return
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != item.faculty_id:
                raise HTTPException(status_code=403, detail="Forbidden delete")
        await self.repo.delete_schedule_item(item)

    # ---------- Blocked Slots ----------

    async def create_blocked_slot(self, data: BlockedSlotCreate) -> BlockedSlot:
        slot = BlockedSlot(
            name=data.name,
            type=data.type,
            day_of_week=data.day_of_week,
            date=getattr(data, 'date', None),
            start_time=data.start_time,
            end_time=data.end_time,
            applies_to=data.applies_to,
            semester_id=data.semester_id,
        )
        return await self.repo.create_blocked_slot(slot)

    async def get_blocked_slots(self, semester_id: int | None = None) -> list[BlockedSlot]:
        return await self.repo.get_blocked_slots(semester_id=semester_id)

    async def delete_blocked_slot(self, id: int) -> None:
        slot = await self.repo.get_blocked_slot(id)
        if not slot:
            raise HTTPException(status_code=404, detail="Blocked slot not found")
        await self.repo.delete_blocked_slot(slot)
