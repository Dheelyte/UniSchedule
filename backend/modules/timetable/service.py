from fastapi import Depends, HTTPException, BackgroundTasks
from datetime import date, datetime, timezone
from modules.timetable.repository import TimetableRepository
from modules.calendar.repository import CalendarRepository
from modules.timetable.models import Faculty, Room, Course, ScheduleItem, Department, CourseScope, BlockedSlot, TimetableLock, CourseEnrollment
from modules.timetable.schemas import (
    FacultyCreate, RoomCreate, CourseCreate, ScheduleItemCreate, DepartmentCreate, ScheduleItemUpdate,
    FacultyUpdate, DepartmentUpdate, RoomUpdate, CourseUpdate, BlockedSlotCreate, RoomReorderRequest
)
from modules.auth.models import RoleEnum
from modules.auth.repository import AuthRepository
from modules.notifications.service import NotificationService
from sqlalchemy.exc import IntegrityError


def _has_global_scope(user: dict) -> bool:
    return user.get("role") in (RoleEnum.SUPER_ADMIN.value, RoleEnum.SUPER_VIEWER.value, RoleEnum.GS_ADMIN.value)


def _is_gs_admin(user: dict) -> bool:
    return user.get("role") == RoleEnum.GS_ADMIN.value


class TimetableService:
    def __init__(
        self,
        repo: TimetableRepository = Depends(),
        cal_repo: CalendarRepository = Depends(),
        auth_repo: AuthRepository = Depends(),
        notification_service: NotificationService = Depends(),
    ):
        self.repo = repo
        self.cal_repo = cal_repo
        self.auth_repo = auth_repo
        self.notification_service = notification_service
        
    async def create_faculty(self, data: FacultyCreate) -> Faculty:
        faculty = Faculty(id=data.id, name=data.name)
        return await self.repo.create_faculty(faculty)

    async def get_faculties(self, current_user: dict, all: bool = False) -> list[Faculty]:
        if all:
            return await self.repo.get_faculties(faculty_id=None)
        faculty_id = None if _has_global_scope(current_user) else current_user.get('faculty_id')
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

    async def get_departments(self, current_user: dict, all: bool = False) -> list[Department]:
        if all:
            return await self.repo.get_departments(faculty_id=None)
        faculty_id = None if _has_global_scope(current_user) else current_user.get('faculty_id')
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
        if _is_gs_admin(current_user):
            if data.faculty_id is not None:
                raise HTTPException(status_code=403, detail="General Studies admins can only create rooms not bound to a faculty")
        room = Room(name=data.name, capacity=data.capacity, faculty_id=data.faculty_id)
        try:
            return await self.repo.create_room(room)
        except IntegrityError:
            raise HTTPException(status_code=400, detail=f"Room '{data.name}' already exists.")

    async def get_rooms(self, current_user: dict, all: bool = False) -> list[Room]:
        if all:
            return await self.repo.get_rooms(faculty_id=None)
        faculty_id = None if _has_global_scope(current_user) else current_user.get('faculty_id')
        return await self.repo.get_rooms(faculty_id=faculty_id)

    async def update_room(self, id: int, data: RoomUpdate, current_user: dict) -> Room:
        room = await self.repo.get_room(id)
        if not room: raise HTTPException(status_code=404, detail="Not found")
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != room.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
        if _is_gs_admin(current_user):
            if room.faculty_id is not None:
                raise HTTPException(status_code=403, detail="General Studies admins cannot edit rooms bound to a faculty")
            if data.faculty_id is not None:
                raise HTTPException(status_code=403, detail="General Studies admins cannot bind rooms to a faculty")
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
        if _is_gs_admin(current_user) and room.faculty_id is not None:
            raise HTTPException(status_code=403, detail="General Studies admins cannot delete rooms bound to a faculty")
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
                if _is_gs_admin(current_user) and room.faculty_id is not None:
                    continue # GS admins reorder only general rooms
                room.display_order = new_order
                updated_rooms.append(room)
                
        await self.repo.db.flush()
        return updated_rooms

    async def create_course(self, data: CourseCreate, current_user: dict) -> Course:
        # GS admins can ONLY create university-wide courses
        if _is_gs_admin(current_user) and data.scope != CourseScope.UNIVERSITY_WIDE.value:
            raise HTTPException(status_code=403, detail="General Studies admins can only create university-wide courses")
        # Only Super Admins and GS admins can create university-wide courses
        if data.scope == CourseScope.UNIVERSITY_WIDE.value:
            if current_user.get("role") not in (RoleEnum.SUPER_ADMIN.value, RoleEnum.GS_ADMIN.value):
                raise HTTPException(status_code=403, detail="Only Super Admins or General Studies admins can create university-wide courses")
        course = Course(
            code=data.code,
            title=data.title,
            credit_load=data.credit_load,
            lecturers=data.lecturers,
            department_id=data.department_id,
            scope=data.scope,
            level=data.level,
        )
        try:
            return await self.repo.create_course(course)
        except IntegrityError:
            raise HTTPException(status_code=400, detail=f"Course code '{data.code}' already exists.")

    async def get_courses(self, current_user: dict) -> list[Course]:
        faculty_id = None if _has_global_scope(current_user) else current_user.get('faculty_id')
        return await self.repo.get_courses(faculty_id=faculty_id)

    async def update_course(self, id: int, data: CourseUpdate, current_user: dict) -> Course:
        course = await self.repo.get_course(id)
        if not course: raise HTTPException(status_code=404, detail="Not found")
        # GS admins may only edit existing UW courses, and may not change scope away from UW
        if _is_gs_admin(current_user):
            if course.scope != CourseScope.UNIVERSITY_WIDE:
                raise HTTPException(status_code=403, detail="General Studies admins can only edit university-wide courses")
            if data.scope is not None and data.scope != CourseScope.UNIVERSITY_WIDE.value:
                raise HTTPException(status_code=403, detail="General Studies admins cannot change scope away from university-wide")
        # Only Super Admins (and GS admins, scoped above) can set scope to UNIVERSITY_WIDE
        if data.scope == CourseScope.UNIVERSITY_WIDE.value:
            if current_user.get("role") not in (RoleEnum.SUPER_ADMIN.value, RoleEnum.GS_ADMIN.value):
                raise HTTPException(status_code=403, detail="Only Super Admins or General Studies admins can set university-wide scope")
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
        if data.level is not None: course.level = data.level
        try:
            return await self.repo.update_course(course)
        except IntegrityError:
            raise HTTPException(status_code=400, detail="A course with this code already exists.")

    async def delete_course(self, id: int, current_user: dict) -> None:
        course = await self.repo.get_course(id)
        if course:
            if _is_gs_admin(current_user) and course.scope != CourseScope.UNIVERSITY_WIDE:
                raise HTTPException(status_code=403, detail="General Studies admins can only delete university-wide courses")
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

            # All blocked slots now have time ranges - check overlap
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

    async def _assert_not_locked(self, semester_id: int | None, item_type: str) -> None:
        if semester_id is None:
            return
        lock = await self.repo.get_lock(semester_id, item_type)
        if lock and lock.is_locked:
            raise HTTPException(status_code=423, detail=f"This {item_type} timetable is locked.")

    async def create_schedule_item(self, data: ScheduleItemCreate, current_user: dict) -> ScheduleItem:
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != data.faculty_id:
                raise HTTPException(status_code=403, detail="Strictly forbidden to schedule outside assigned faculty")
        if _is_gs_admin(current_user):
            course = await self.repo.get_course(data.course_id)
            if not course or course.scope != CourseScope.UNIVERSITY_WIDE:
                raise HTTPException(status_code=403, detail="General Studies admins can only schedule university-wide courses")
            data.faculty_id = None

        # Verify schedule targets the current semester
        current_sem = await self.cal_repo.get_current_semester()
        if not current_sem:
            raise HTTPException(status_code=400, detail="No active semester found. Please create a current semester before scheduling.")
        if data.semester_id is not None and data.semester_id != current_sem.id:
            raise HTTPException(status_code=403, detail="You can only schedule courses for the current semester.")

        sem_id = data.semester_id or current_sem.id
        await self._assert_not_locked(sem_id, data.type)
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
        faculty_id = None if _has_global_scope(current_user) else current_user.get('faculty_id')
        return await self.repo.get_schedule_items(semester_id=semester_id, faculty_id=faculty_id)
        
    async def update_schedule_item(self, id: int, data: ScheduleItemUpdate, current_user: dict) -> ScheduleItem:
        item = await self.repo.get_schedule_item(id)
        if not item:
            raise HTTPException(status_code=404, detail="Schedule missing")
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != item.faculty_id:
                raise HTTPException(status_code=403, detail="Forbidden update")
        if _is_gs_admin(current_user):
            course = await self.repo.get_course(item.course_id)
            if not course or course.scope != CourseScope.UNIVERSITY_WIDE:
                raise HTTPException(status_code=403, detail="General Studies admins can only edit university-wide schedule items")
        await self._assert_not_locked(item.semester_id, item.type)
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
        if _is_gs_admin(current_user):
            course = await self.repo.get_course(item.course_id)
            if not course or course.scope != CourseScope.UNIVERSITY_WIDE:
                raise HTTPException(status_code=403, detail="General Studies admins can only delete university-wide schedule items")
        await self._assert_not_locked(item.semester_id, item.type)
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

    # ---------- Timetable Locks ----------

    async def list_locks(self, semester_id: int) -> list[TimetableLock]:
        existing = await self.repo.list_locks(semester_id)
        by_type = {lock.timetable_type: lock for lock in existing}
        for t in ("lecture", "exam"):
            if t not in by_type:
                by_type[t] = TimetableLock(
                    semester_id=semester_id,
                    timetable_type=t,
                    is_locked=False,
                    locked_by=None,
                    locked_at=None,
                )
        return [by_type["lecture"], by_type["exam"]]

    async def set_lock(self, semester_id: int, timetable_type: str, is_locked: bool, current_user: dict) -> TimetableLock:
        if timetable_type not in ("lecture", "exam"):
            raise HTTPException(status_code=400, detail="timetable_type must be 'lecture' or 'exam'")
        sub = current_user.get("sub")
        user_id = int(sub) if sub is not None else None
        try:
            return await self.repo.upsert_lock(semester_id, timetable_type, is_locked, user_id)
        except IntegrityError:
            raise HTTPException(status_code=404, detail="Semester not found")

    async def request_edit(
        self,
        semester_id: int,
        timetable_type: str,
        reason: str | None,
        current_user: dict,
        background_tasks: BackgroundTasks,
    ) -> None:
        if timetable_type not in ("lecture", "exam"):
            raise HTTPException(status_code=400, detail="timetable_type must be 'lecture' or 'exam'")
        if current_user.get("role") == RoleEnum.SUPER_ADMIN.value:
            raise HTTPException(status_code=403, detail="Super admins can unlock directly")
        if current_user.get("role") != RoleEnum.FACULTY_EDITOR.value:
            raise HTTPException(status_code=403, detail="Only faculty editors can request edit access")

        lock = await self.repo.get_lock(semester_id, timetable_type)
        if not lock or not lock.is_locked:
            raise HTTPException(status_code=409, detail=f"This {timetable_type} timetable is not locked")

        sub = current_user.get("sub")
        requester_id = int(sub) if sub is not None else None
        requester = await self.auth_repo.get_user_by_id(requester_id) if requester_id is not None else None
        requester_email = requester.email if requester else current_user.get("email", "Unknown user")

        admins = await self.auth_repo.get_users_by_role(RoleEnum.SUPER_ADMIN)
        admin_ids = [a.id for a in admins]
        if not admin_ids:
            return

        title = f"Edit access requested for {timetable_type} timetable"
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        message = (
            f"{requester_email} requested edit access on {timestamp}.\n"
            f"Reason: {reason.strip() if reason else '—'}"
        )
        link = f"/timetable/{'lectures' if timetable_type == 'lecture' else 'exams'}"

        await self.notification_service.notify(
            user_ids=admin_ids,
            title=title,
            message=message,
            link=link,
            send_email=False,
            background_tasks=background_tasks,
        )

    # ---------- Course Enrollments (per dept × level) ----------

    async def list_enrollments(self, current_user: dict, course_id: int | None = None) -> list[CourseEnrollment]:
        if _has_global_scope(current_user):
            return await self.repo.list_enrollments(course_id=course_id)
        faculty_id = current_user.get("faculty_id")
        if not faculty_id:
            return []
        return await self.repo.list_enrollments(faculty_id=faculty_id, course_id=course_id)

    async def _check_dept_belongs_to_user_faculty(self, department_id: int, current_user: dict) -> Department:
        dept = await self.repo.get_department(department_id)
        if not dept:
            raise HTTPException(status_code=404, detail="Department not found")
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            user_fid = current_user.get("faculty_id")
            if not user_fid or dept.faculty_id != user_fid:
                raise HTTPException(status_code=403, detail="You can only manage enrollments for departments in your faculty")
        elif current_user.get("role") != RoleEnum.SUPER_ADMIN.value:
            raise HTTPException(status_code=403, detail="Not authorized")
        return dept

    async def create_enrollment(self, course_id: int, department_id: int, level: int, current_user: dict) -> CourseEnrollment:
        await self._check_dept_belongs_to_user_faculty(department_id, current_user)

        course = await self.repo.get_course(course_id)
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        if course.scope == CourseScope.DEPARTMENTAL:
            raise HTTPException(status_code=400, detail="Departmental courses are auto-audienced; no enrollment needed")

        # Idempotent: return existing if already enrolled at this dept × level.
        existing = await self.repo.get_enrollment(course_id, department_id, level)
        if existing:
            return existing

        sub = current_user.get("sub")
        actor_id = int(sub) if sub is not None else None
        enrollment = CourseEnrollment(
            course_id=course_id,
            department_id=department_id,
            level=level,
            enrolled_by=actor_id,
        )
        try:
            return await self.repo.create_enrollment(enrollment)
        except IntegrityError:
            raise HTTPException(status_code=400, detail="Enrollment already exists or invalid references")

    async def delete_enrollment(self, course_id: int, department_id: int, level: int, current_user: dict) -> None:
        await self._check_dept_belongs_to_user_faculty(department_id, current_user)
        enrollment = await self.repo.get_enrollment(course_id, department_id, level)
        if not enrollment:
            raise HTTPException(status_code=404, detail="Enrollment not found")
        await self.repo.delete_enrollment(enrollment)
