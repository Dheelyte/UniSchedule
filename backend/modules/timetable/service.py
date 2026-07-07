from fastapi import Depends, HTTPException
from datetime import date, datetime, timezone
from modules.timetable.repository import TimetableRepository
from modules.calendar.repository import CalendarRepository
from modules.timetable.models import Faculty, Room, Course, ScheduleItem, Department, CourseScope, BlockedSlot, TimetableLock, CourseEnrollment, ChangeRequest, ChangeRequestAction, ChangeRequestStatus, ConflictDismissal
from modules.timetable.schemas import (
    FacultyCreate, RoomCreate, CourseCreate, ScheduleItemCreate, DepartmentCreate, ScheduleItemUpdate,
    FacultyUpdate, DepartmentUpdate, RoomUpdate, CourseUpdate, BlockedSlotCreate, RoomReorderRequest,
    ChangeRequestCreate, ConflictDismissalCreate, ConflictDismissalBulkCreate
)
from modules.auth.models import RoleEnum
from modules.auth.repository import AuthRepository
from modules.notifications.service import NotificationService
from modules.audit.service import AuditService
from sqlalchemy.exc import IntegrityError


def _has_global_scope(user: dict) -> bool:
    return user.get("role") in (RoleEnum.SUPER_ADMIN.value, RoleEnum.SUPER_VIEWER.value, RoleEnum.GS_ADMIN.value, RoleEnum.CITS_ADMIN.value)


def _has_global_read_scope(user: dict) -> bool:
    return user.get("role") in (
        RoleEnum.SUPER_ADMIN.value,
        RoleEnum.SUPER_VIEWER.value,
        RoleEnum.GS_ADMIN.value,
        RoleEnum.FACULTY_EDITOR.value,
        RoleEnum.FACULTY_VIEWER.value,
        RoleEnum.CITS_ADMIN.value,
    )


def _is_gs_admin(user: dict) -> bool:
    return user.get("role") == RoleEnum.GS_ADMIN.value


def _normalize_signature(conflict_type: str, item_a_id: int, item_b_id: int | None):
    """Order the pair so a signature is stable regardless of argument order."""
    if item_b_id is not None and item_b_id < item_a_id:
        item_a_id, item_b_id = item_b_id, item_a_id
    return conflict_type, item_a_id, item_b_id


# Higher number = higher scheduling priority. A higher-priority item is allowed to
# overlap with a lower-priority one — the lower-priority item's faculty editors are
# notified so they can reschedule.
_SCOPE_PRIORITY = {
    CourseScope.UNIVERSITY_WIDE.value: 3,
    CourseScope.INTERFACULTY.value: 2,
    CourseScope.DEPARTMENTAL.value: 1,
}


def _scope_priority(scope) -> int:
    if scope is None:
        return 0
    val = scope.value if hasattr(scope, 'value') else str(scope)
    return _SCOPE_PRIORITY.get(val, 0)


def _times_overlap(a_start, a_end, b_start, b_end) -> bool:
    return a_start < b_end and b_start < a_end


class TimetableService:
    def __init__(
        self,
        repo: TimetableRepository = Depends(),
        cal_repo: CalendarRepository = Depends(),
        auth_repo: AuthRepository = Depends(),
        notification_service: NotificationService = Depends(),
        audit_service: AuditService = Depends(),
    ):
        self.repo = repo
        self.cal_repo = cal_repo
        self.auth_repo = auth_repo
        self.notification_service = notification_service
        self.audit_service = audit_service
        
    async def create_faculty(self, data: FacultyCreate, current_user: dict | None = None) -> Faculty:
        faculty = Faculty(id=data.id, name=data.name, is_special=data.is_special)
        created = await self.repo.create_faculty(faculty)
        await self.audit_service.log(
            current_user=current_user,
            action="faculty.create",
            entity_type="faculty",
            entity_id=created.id,
            description=f"Created faculty {created.id} ({created.name})",
            extra={"id": created.id, "name": created.name},
        )
        return created

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
        if data.is_special is not None: faculty.is_special = data.is_special
        updated = await self.repo.update_faculty(faculty)
        await self.audit_service.log(
            current_user=current_user,
            action="faculty.update",
            entity_type="faculty",
            entity_id=updated.id,
            description=f"Updated faculty {updated.id} ({updated.name})",
            extra=data.model_dump(exclude_unset=True),
        )
        return updated

    async def delete_faculty(self, id: str, current_user: dict) -> None:
        if current_user.get("role") != RoleEnum.SUPER_ADMIN.value:
            raise HTTPException(status_code=403, detail="Not authorized")
        faculty = await self.repo.get_faculty(id)
        if faculty:
            try:
                await self.repo.delete_faculty(faculty)
            except IntegrityError:
                raise HTTPException(status_code=400, detail="Cannot delete faculty because it is currently referenced by other records (such as departments or schedule items). Please remove them first.")
            await self.audit_service.log(
                current_user=current_user,
                action="faculty.delete",
                entity_type="faculty",
                entity_id=faculty.id,
                description=f"Deleted faculty {faculty.id} ({faculty.name})",
            )

    async def create_department(self, data: DepartmentCreate, current_user: dict) -> Department:
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != data.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
        dept = Department(name=data.name, faculty_id=data.faculty_id)
        created = await self.repo.create_department(dept)
        await self.audit_service.log(
            current_user=current_user,
            action="department.create",
            entity_type="department",
            entity_id=created.id,
            description=f"Created department '{created.name}' in faculty {created.faculty_id}",
            extra={"name": created.name, "faculty_id": created.faculty_id},
        )
        return created

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
        updated = await self.repo.update_department(dept)
        await self.audit_service.log(
            current_user=current_user,
            action="department.update",
            entity_type="department",
            entity_id=updated.id,
            description=f"Updated department {updated.id} ({updated.name})",
            extra=data.model_dump(exclude_unset=True),
        )
        return updated

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
        await self.audit_service.log(
            current_user=current_user,
            action="department.delete",
            entity_type="department",
            entity_id=dept.id,
            description=f"Deleted department {dept.id} ({dept.name})",
        )

    async def create_room(self, data: RoomCreate, current_user: dict) -> Room:
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != data.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized to bind this resource off-scope")
        if _is_gs_admin(current_user):
            if data.faculty_id is not None:
                raise HTTPException(status_code=403, detail="General Studies admins can only create rooms not bound to a faculty")
        room = Room(
            name=data.name,
            capacity=data.capacity,
            faculty_id=data.faculty_id,
            is_lab=data.is_lab,
            is_active=data.is_active,
        )
        try:
            created = await self.repo.create_room(room)
        except IntegrityError:
            raise HTTPException(status_code=400, detail=f"Room '{data.name}' already exists.")
        await self.audit_service.log(
            current_user=current_user,
            action="room.create",
            entity_type="room",
            entity_id=created.id,
            description=f"Created room '{created.name}' (capacity {created.capacity})",
            extra={"name": created.name, "capacity": created.capacity, "faculty_id": created.faculty_id, "is_active": created.is_active},
        )
        return created

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
        if data.is_lab is not None: room.is_lab = data.is_lab
        if data.faculty_id is not None:
            if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value and current_user.get("faculty_id") != data.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
            room.faculty_id = data.faculty_id
        if data.is_active is not None:
            if current_user.get("role") != RoleEnum.SUPER_ADMIN.value:
                raise HTTPException(status_code=403, detail="Only super admins can activate or deactivate a room")
            room.is_active = data.is_active
        try:
            updated = await self.repo.update_room(room)
        except IntegrityError:
            raise HTTPException(status_code=400, detail=f"Room name must be unique.")
        await self.audit_service.log(
            current_user=current_user,
            action="room.update",
            entity_type="room",
            entity_id=updated.id,
            description=f"Updated room {updated.id} ({updated.name})",
            extra=data.model_dump(exclude_unset=True),
        )
        return updated

    async def delete_room(self, id: int, current_user: dict) -> None:
        room = await self.repo.get_room(id)
        if not room: return
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != room.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
        if _is_gs_admin(current_user) and room.faculty_id is not None:
            raise HTTPException(status_code=403, detail="General Studies admins cannot delete rooms bound to a faculty")

        is_referenced = await self.repo.is_room_referenced_by_schedule(id)
        if is_referenced:
            raise HTTPException(status_code=400, detail="Cannot delete room because it is currently assigned to scheduled items. Please remove it from all timetables first.")

        try:
            await self.repo.delete_room(room)
        except IntegrityError:
            raise HTTPException(status_code=400, detail="Cannot delete room because it is currently referenced by other records. Please remove them first.")
        await self.audit_service.log(
            current_user=current_user,
            action="room.delete",
            entity_type="room",
            entity_id=room.id,
            description=f"Deleted room {room.id} ({room.name})",
        )

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
        # Faculty editors may only add courses to departments within their own faculty
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value and data.department_id is not None:
            dept = await self.repo.get_department(data.department_id)
            if not dept:
                raise HTTPException(status_code=400, detail="Department not found")
            if dept.faculty_id != current_user.get("faculty_id"):
                raise HTTPException(status_code=403, detail="Faculty editors can only add courses to departments in their own faculty")
        course = Course(
            code=data.code,
            title=data.title or "",
            credit_load=data.credit_load,
            lecturers=data.lecturers,
            department_id=data.department_id,
            scope=data.scope,
            level=data.level,
            semester=data.semester,
            is_cbt_exam=data.is_cbt_exam,
        )
        try:
            created = await self.repo.create_course(course)
        except IntegrityError:
            raise HTTPException(status_code=400, detail=f"Course code '{data.code}' already exists.")
        await self.audit_service.log(
            current_user=current_user,
            action="course.create",
            entity_type="course",
            entity_id=created.id,
            description=f"Created course {created.code} ({created.title})",
            extra={
                "code": created.code,
                "title": created.title,
                "scope": created.scope.value if hasattr(created.scope, 'value') else str(created.scope),
                "department_id": created.department_id,
                "level": created.level,
                "semester": created.semester,
            },
        )
        return created

    async def get_courses(self, current_user: dict) -> list[Course]:
        faculty_id = None if _has_global_read_scope(current_user) else current_user.get('faculty_id')
        return await self.repo.get_courses(faculty_id=faculty_id)

    async def update_course(self, id: int, data: CourseUpdate, current_user: dict) -> Course:
        course = await self.repo.get_course(id)
        if not course: raise HTTPException(status_code=404, detail="Not found")
        
        # If user is CITS admin, they can ONLY update the `is_cbt_exam` field
        if current_user.get("role") == RoleEnum.CITS_ADMIN.value:
            non_cbt_fields = [f for f in data.model_fields_set if f != "is_cbt_exam"]
            if non_cbt_fields:
                raise HTTPException(
                    status_code=403,
                    detail="Super Administrator (CITS) is only authorized to update the CBT status (is_cbt_exam) of courses"
                )
        
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
        # Faculty editors may only edit courses in their own faculty, and cannot move them out.
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            user_faculty = current_user.get("faculty_id")
            current_dept = await self.repo.get_department(course.department_id) if course.department_id else None
            if current_dept and current_dept.faculty_id != user_faculty:
                raise HTTPException(status_code=403, detail="Faculty editors can only edit courses in their own faculty")
            if data.department_id is not None:
                target_dept = await self.repo.get_department(data.department_id)
                if not target_dept:
                    raise HTTPException(status_code=400, detail="Department not found")
                if target_dept.faculty_id != user_faculty:
                    raise HTTPException(status_code=403, detail="Faculty editors can only assign courses to departments in their own faculty")
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
        # `semester` is nullable — accept None to clear, distinguish from "not provided" via model_fields_set
        if 'semester' in data.model_fields_set: course.semester = data.semester
        if data.is_cbt_exam is not None: course.is_cbt_exam = data.is_cbt_exam
        try:
            updated = await self.repo.update_course(course)
        except IntegrityError:
            raise HTTPException(status_code=400, detail="A course with this code already exists.")
        await self.audit_service.log(
            current_user=current_user,
            action="course.update",
            entity_type="course",
            entity_id=updated.id,
            description=f"Updated course {updated.code} ({updated.title})",
            extra=data.model_dump(exclude_unset=True),
        )
        return updated

    async def delete_course(self, id: int, current_user: dict) -> None:
        course = await self.repo.get_course(id)
        if course:
            if _is_gs_admin(current_user) and course.scope != CourseScope.UNIVERSITY_WIDE:
                raise HTTPException(status_code=403, detail="General Studies admins can only delete university-wide courses")
            
            is_referenced = await self.repo.is_course_referenced_by_schedule(id)
            if is_referenced:
                raise HTTPException(status_code=400, detail="Cannot delete course because it is currently scheduled. Please unschedule it from all timetables first.")

            try:
                await self.repo.delete_course(course)
            except IntegrityError:
                raise HTTPException(status_code=400, detail="Cannot delete course because it is currently referenced by other records. Please remove them first.")
            await self.audit_service.log(
                current_user=current_user,
                action="course.delete",
                entity_type="course",
                entity_id=course.id,
                description=f"Deleted course {course.code} ({course.title})",
            )

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

            match_day = False
            if slot.date and exam_date:
                match_day = slot.date == exam_date
            elif slot.day_of_week and day_of_week:
                match_day = slot.day_of_week == day_of_week
            if not match_day:
                continue

            # Whole-day block: no time range → conflict any time
            if not slot.start_time or not slot.end_time:
                raise HTTPException(
                    status_code=400,
                    detail=f"Time conflict with blocked slot '{slot.name}' (whole day)"
                )
            if start_time < slot.end_time and end_time > slot.start_time:
                raise HTTPException(
                    status_code=400,
                    detail=f"Time conflict with blocked slot '{slot.name}' ({slot.start_time.strftime('%H:%M')}–{slot.end_time.strftime('%H:%M')})"
                )

    async def _notify_priority_overrides(
        self,
        new_item: ScheduleItem,
    ) -> None:
        """If `new_item` collides with lower-priority items, notify the affected faculty editors.

        Collisions considered: same day/exam_date + overlapping time AND
        (shared room OR same course OR overlapping student audience).
        Lower priority is determined by the originating course scope.
        """
        new_course = await self.repo.get_course(new_item.course_id)
        if not new_course:
            return
        new_priority = _scope_priority(new_course.scope)
        if new_priority <= 1:
            return  # Departmental items can't override anything

        sem_id = new_item.semester_id
        if sem_id is None:
            current_sem = await self.cal_repo.get_current_semester()
            sem_id = current_sem.id if current_sem else None
        if sem_id is None:
            return
        siblings = await self.repo.get_schedule_items(semester_id=sem_id)

        # Audience: a UW course targets every (dept, level); a scoped course targets
        # its own (dept, level). Two items "share an audience" if either side is UW
        # or if their (dept_id, level) match (with NULL level acting as a wildcard).
        def audience_overlaps(a_course: Course, b_course: Course) -> bool:
            a_uw = a_course.scope == CourseScope.UNIVERSITY_WIDE
            b_uw = b_course.scope == CourseScope.UNIVERSITY_WIDE
            if a_uw or b_uw:
                if a_course.level is None or b_course.level is None:
                    return True
                return a_course.level == b_course.level
            if a_course.department_id != b_course.department_id:
                return False
            if a_course.level is None or b_course.level is None:
                return True
            return a_course.level == b_course.level

        new_rooms = set(new_item.room_ids or [])
        affected: list[tuple[ScheduleItem, Course]] = []
        for s in siblings:
            if s.id == new_item.id or s.type != new_item.type:
                continue
            # Same calendar slot
            if new_item.type == "exam":
                if (s.exam_date or None) != (new_item.exam_date or None):
                    continue
            else:
                if (s.day_of_week or None) != (new_item.day_of_week or None):
                    continue
            if not _times_overlap(new_item.start_time, new_item.end_time, s.start_time, s.end_time):
                continue

            other_course = await self.repo.get_course(s.course_id)
            if not other_course:
                continue
            if _scope_priority(other_course.scope) >= new_priority:
                continue

            shares_room = bool(new_rooms.intersection(set(s.room_ids or [])))
            same_course = s.course_id == new_item.course_id
            shares_audience = audience_overlaps(new_course, other_course)
            if not (shares_room or same_course or shares_audience):
                continue

            affected.append((s, other_course))

        if not affected:
            return

        # Collect faculty ids to notify: prefer schedule item's faculty, fall back to dept's faculty.
        faculty_ids: set[str] = set()
        for s, c in affected:
            if s.faculty_id:
                faculty_ids.add(s.faculty_id)
            elif c.department_id:
                dept = await self.repo.get_department(c.department_id)
                if dept and dept.faculty_id:
                    faculty_ids.add(dept.faculty_id)

        if not faculty_ids:
            return
        editors = await self.auth_repo.get_faculty_editors_in_faculties(list(faculty_ids))
        editor_ids = [u.id for u in editors]
        if not editor_ids:
            return

        course_lines = ", ".join(f"{c.code} ({c.title})" for _, c in affected)
        title = "Timetable conflict: please review"
        message = (
            f"{new_course.code} ({new_course.scope.value.replace('_', '-').title()}) "
            f"was scheduled and now conflicts with {course_lines}. "
            f"Please reschedule the affected course(s) to resolve the clash."
        )
        link = "/timetable/exams" if new_item.type == "exam" else "/timetable/lectures"
        # Lambda-friendly: send the email inline rather than via BackgroundTasks,
        # which is unreliable on AWS Lambda (the worker can be frozen after the
        # response is returned).
        await self.notification_service.notify(
            user_ids=editor_ids,
            title=title,
            message=message,
            link=link,
            send_email=True,
        )

    async def _assert_not_locked(self, semester_id: int | None, item_type: str) -> None:
        if semester_id is None:
            return
        lock = await self.repo.get_lock(semester_id, item_type)
        if lock and lock.is_locked:
            raise HTTPException(status_code=423, detail=f"This {item_type} timetable is locked.")

    async def _assert_rooms_active(self, room_ids: list[int] | None, already_assigned_ids: list[int] | None = None) -> None:
        already_assigned_ids = already_assigned_ids or []
        new_ids = [rid for rid in (room_ids or []) if rid not in already_assigned_ids]
        if not new_ids:
            return
        rooms = await self.repo.get_rooms_by_ids(new_ids)
        inactive = [r.name for r in rooms if r.is_active is False]
        if inactive:
            raise HTTPException(status_code=400, detail=f"Cannot schedule into inactive room(s): {', '.join(inactive)}")

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
        await self._assert_rooms_active(data.room_ids)

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
            semester_id=sem_id,
        )
        created = await self.repo.create_schedule_item(item)
        await self._notify_priority_overrides(created)
        course = await self.repo.get_course(created.course_id)
        await self.audit_service.log(
            current_user=current_user,
            action=f"schedule_item.{created.type}.create",
            entity_type="schedule_item",
            entity_id=created.id,
            description=f"Scheduled {created.type} for {course.code if course else f'course #{created.course_id}'} on {created.exam_date or created.day_of_week} {created.start_time}-{created.end_time}",
            extra={
                "course_id": created.course_id,
                "course_code": course.code if course else None,
                "type": created.type,
                "day_of_week": created.day_of_week,
                "exam_date": created.exam_date.isoformat() if created.exam_date else None,
                "start_time": str(created.start_time),
                "end_time": str(created.end_time),
                "room_ids": created.room_ids,
                "faculty_id": created.faculty_id,
                "semester_id": created.semester_id,
            },
        )
        return created

    async def get_schedule_items(self, current_user: dict, semester_id: int | None = None) -> list[ScheduleItem]:
        faculty_id = None if _has_global_read_scope(current_user) else current_user.get('faculty_id')
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
        if data.room_ids is not None:
            await self._assert_rooms_active(data.room_ids, already_assigned_ids=item.room_ids or [])
            item.room_ids = data.room_ids
        if data.day_of_week is not None: item.day_of_week = data.day_of_week
        if data.exam_date is not None: item.exam_date = data.exam_date
        if data.start_time is not None: item.start_time = data.start_time
        if data.end_time is not None: item.end_time = data.end_time
        updated = await self.repo.update_schedule_item(item)
        await self._notify_priority_overrides(updated)
        course = await self.repo.get_course(updated.course_id)
        await self.audit_service.log(
            current_user=current_user,
            action=f"schedule_item.{updated.type}.update",
            entity_type="schedule_item",
            entity_id=updated.id,
            description=f"Updated {updated.type} for {course.code if course else f'course #{updated.course_id}'}",
            extra=data.model_dump(exclude_unset=True, mode='json'),
        )
        return updated

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
        course = await self.repo.get_course(item.course_id)
        await self.repo.delete_schedule_item(item)
        await self.audit_service.log(
            current_user=current_user,
            action=f"schedule_item.{item.type}.delete",
            entity_type="schedule_item",
            entity_id=item.id,
            description=f"Removed {item.type} for {course.code if course else f'course #{item.course_id}'} from {item.exam_date or item.day_of_week} {item.start_time}-{item.end_time}",
        )

    # ---------- Blocked Slots ----------

    async def create_blocked_slot(self, data: BlockedSlotCreate, current_user: dict | None = None) -> BlockedSlot:
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
        created = await self.repo.create_blocked_slot(slot)
        await self.audit_service.log(
            current_user=current_user,
            action="blocked_slot.create",
            entity_type="blocked_slot",
            entity_id=created.id,
            description=f"Added blocked slot '{created.name}' ({created.applies_to})",
            extra={
                "name": created.name,
                "applies_to": created.applies_to,
                "day_of_week": created.day_of_week,
                "date": created.date.isoformat() if created.date else None,
                "start_time": str(created.start_time) if created.start_time else None,
                "end_time": str(created.end_time) if created.end_time else None,
                "semester_id": created.semester_id,
            },
        )
        return created

    async def get_blocked_slots(self, semester_id: int | None = None) -> list[BlockedSlot]:
        return await self.repo.get_blocked_slots(semester_id=semester_id)

    async def delete_blocked_slot(self, id: int, current_user: dict | None = None) -> None:
        slot = await self.repo.get_blocked_slot(id)
        if not slot:
            raise HTTPException(status_code=404, detail="Blocked slot not found")
        await self.repo.delete_blocked_slot(slot)
        await self.audit_service.log(
            current_user=current_user,
            action="blocked_slot.delete",
            entity_type="blocked_slot",
            entity_id=slot.id,
            description=f"Removed blocked slot '{slot.name}'",
        )

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
            lock = await self.repo.upsert_lock(semester_id, timetable_type, is_locked, user_id)
        except IntegrityError:
            raise HTTPException(status_code=404, detail="Semester not found")
        await self.audit_service.log(
            current_user=current_user,
            action=f"timetable.{'lock' if is_locked else 'unlock'}",
            entity_type="timetable_lock",
            entity_id=f"{semester_id}:{timetable_type}",
            description=f"{'Locked' if is_locked else 'Unlocked'} {timetable_type} timetable for semester {semester_id}",
            extra={"semester_id": semester_id, "timetable_type": timetable_type, "is_locked": is_locked},
        )
        return lock

    async def request_edit(
        self,
        semester_id: int,
        timetable_type: str,
        reason: str | None,
        current_user: dict,
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
        )
        await self.audit_service.log(
            current_user=current_user,
            action="timetable.edit_request",
            entity_type="timetable_lock",
            entity_id=f"{semester_id}:{timetable_type}",
            description=f"Requested edit access to {timetable_type} timetable for semester {semester_id}",
            extra={"reason": reason},
        )

    # ---------- Change Requests ----------

    _CHANGE_REQUEST_ROLES = (
        RoleEnum.FACULTY_EDITOR.value,
        RoleEnum.FACULTY_VIEWER.value,
        RoleEnum.GS_ADMIN.value,
        RoleEnum.SUPER_VIEWER.value,
    )

    async def _enrich_change_request(self, cr: ChangeRequest) -> dict:
        course = await self.repo.get_course(cr.course_id) if cr.course_id is not None else None
        requester = await self.auth_repo.get_user_by_id(cr.requested_by) if cr.requested_by is not None else None
        data = {c.name: getattr(cr, c.name) for c in cr.__table__.columns}
        data["course_code"] = course.code if course else None
        data["course_title"] = course.title if course else None
        data["requester_email"] = requester.email if requester else None
        return data

    async def _assert_request_scope(self, cr_action: str, course_id: int, target: ScheduleItem | None, current_user: dict) -> None:
        """Faculty editors/viewers may only request changes within their own faculty.
        GS admins and super viewers have global scope."""
        if _has_global_scope(current_user):
            return
        faculty_id = current_user.get("faculty_id")
        if not faculty_id:
            raise HTTPException(status_code=403, detail="Your account has no assigned faculty")
        if target is not None and target.faculty_id == faculty_id:
            return
        # Otherwise the course must be enrolled to a department in the user's faculty
        enrollments = await self.repo.list_enrollments(faculty_id=faculty_id, course_id=course_id)
        if not enrollments:
            raise HTTPException(status_code=403, detail="You can only request changes for courses in your faculty")

    async def create_change_request(self, data: ChangeRequestCreate, current_user: dict) -> dict:
        role = current_user.get("role")
        if role not in self._CHANGE_REQUEST_ROLES:
            raise HTTPException(status_code=403, detail="Your role cannot submit change requests")

        current_sem = await self.cal_repo.get_current_semester()
        if not current_sem:
            raise HTTPException(status_code=400, detail="No active semester found.")
        if data.semester_id is not None and data.semester_id != current_sem.id:
            raise HTTPException(status_code=403, detail="You can only request changes for the current semester.")
        sem_id = data.semester_id or current_sem.id

        lock = await self.repo.get_lock(sem_id, data.timetable_type)
        if lock and lock.is_locked:
            raise HTTPException(status_code=423, detail=f"This {data.timetable_type} timetable is locked.")

        course = await self.repo.get_course(data.course_id)
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")

        target = None
        if data.action in (ChangeRequestAction.MODIFY.value, ChangeRequestAction.REMOVE.value):
            target = await self.repo.get_schedule_item(data.target_schedule_item_id)
            if not target:
                raise HTTPException(status_code=404, detail="The schedule item to change no longer exists")
            if target.semester_id != sem_id or target.type != data.timetable_type:
                raise HTTPException(status_code=400, detail="Target schedule item does not match this timetable")

        await self._assert_request_scope(data.action, data.course_id, target, current_user)

        sub = current_user.get("sub")
        requester_id = int(sub) if sub is not None else None

        cr = ChangeRequest(
            semester_id=sem_id,
            timetable_type=data.timetable_type,
            action=data.action,
            target_schedule_item_id=data.target_schedule_item_id,
            course_id=data.course_id,
            room_ids=data.room_ids,
            faculty_id=data.faculty_id,
            day_of_week=data.day_of_week,
            start_time=data.start_time,
            end_time=data.end_time,
            week=data.week,
            exam_date=data.exam_date,
            reason=data.reason,
            status=ChangeRequestStatus.PENDING.value,
            requested_by=requester_id,
        )
        created = await self.repo.create_change_request(cr)

        requester = await self.auth_repo.get_user_by_id(requester_id) if requester_id is not None else None
        requester_email = requester.email if requester else current_user.get("email", "Unknown user")
        admins = await self.auth_repo.get_users_by_role(RoleEnum.SUPER_ADMIN)
        admin_ids = [a.id for a in admins]
        if admin_ids:
            action_label = {"ADD": "add", "MODIFY": "modify", "REMOVE": "remove"}.get(data.action, data.action.lower())
            title = f"Schedule change requested: {course.code}"
            message = (
                f"{requester_email} requested to {action_label} a {data.timetable_type} session "
                f"for {course.code}.\nReason: {data.reason.strip() if data.reason else '—'}"
            )
            await self.notification_service.notify(
                user_ids=admin_ids,
                title=title,
                message=message,
                link="/requests",
                send_email=False,
            )

        await self.audit_service.log(
            current_user=current_user,
            action="change_request.create",
            entity_type="change_request",
            entity_id=created.id,
            description=f"Requested to {data.action.lower()} {data.timetable_type} schedule for {course.code}",
            extra={"course_id": data.course_id, "action": data.action, "timetable_type": data.timetable_type, "reason": data.reason},
        )
        return await self._enrich_change_request(created)

    async def list_change_requests(
        self,
        current_user: dict,
        semester_id: int | None = None,
        timetable_type: str | None = None,
        status: str | None = None,
    ) -> list[dict]:
        role = current_user.get("role")
        is_reviewer = role in (RoleEnum.SUPER_ADMIN.value, RoleEnum.SUPER_VIEWER.value)
        requested_by = None
        if not is_reviewer:
            sub = current_user.get("sub")
            requested_by = int(sub) if sub is not None else -1
        rows = await self.repo.list_change_requests(
            semester_id=semester_id,
            timetable_type=timetable_type,
            status=status,
            requested_by=requested_by,
        )
        return [await self._enrich_change_request(cr) for cr in rows]

    async def review_change_request(self, id: int, approve: bool, note: str | None, current_user: dict) -> dict:
        cr = await self.repo.get_change_request(id)
        if not cr:
            raise HTTPException(status_code=404, detail="Change request not found")
        if cr.status != ChangeRequestStatus.PENDING.value:
            raise HTTPException(status_code=409, detail=f"This request has already been {cr.status.lower()}")

        if approve:
            lock = await self.repo.get_lock(cr.semester_id, cr.timetable_type)
            if lock and lock.is_locked:
                raise HTTPException(status_code=423, detail="Unlock the timetable before approving this request.")

            if cr.action == ChangeRequestAction.ADD.value:
                payload = ScheduleItemCreate(
                    course_id=cr.course_id,
                    room_ids=cr.room_ids or [],
                    faculty_id=cr.faculty_id,
                    day_of_week=cr.day_of_week,
                    start_time=cr.start_time,
                    end_time=cr.end_time,
                    type=cr.timetable_type,
                    week=cr.week,
                    exam_date=cr.exam_date,
                    semester_id=cr.semester_id,
                )
                created_item = await self.create_schedule_item(payload, current_user)
                cr.resulting_schedule_item_id = created_item.id
            elif cr.action == ChangeRequestAction.MODIFY.value:
                if cr.target_schedule_item_id is None or not await self.repo.get_schedule_item(cr.target_schedule_item_id):
                    raise HTTPException(status_code=409, detail="The target schedule item no longer exists; cannot apply this change.")
                payload = ScheduleItemUpdate(
                    room_ids=cr.room_ids,
                    day_of_week=cr.day_of_week,
                    exam_date=cr.exam_date,
                    start_time=cr.start_time,
                    end_time=cr.end_time,
                )
                updated_item = await self.update_schedule_item(cr.target_schedule_item_id, payload, current_user)
                cr.resulting_schedule_item_id = updated_item.id
            elif cr.action == ChangeRequestAction.REMOVE.value:
                if cr.target_schedule_item_id is None or not await self.repo.get_schedule_item(cr.target_schedule_item_id):
                    raise HTTPException(status_code=409, detail="The target schedule item no longer exists; cannot apply this change.")
                await self.delete_schedule_item(cr.target_schedule_item_id, current_user)

            cr.status = ChangeRequestStatus.APPROVED.value
        else:
            cr.status = ChangeRequestStatus.REJECTED.value

        sub = current_user.get("sub")
        cr.reviewed_by = int(sub) if sub is not None else None
        cr.reviewed_at = datetime.now(timezone.utc)
        cr.review_note = note
        await self.repo.update_change_request(cr)

        course = await self.repo.get_course(cr.course_id) if cr.course_id is not None else None
        course_label = course.code if course else "the course"
        if cr.requested_by is not None:
            outcome = "approved and applied" if approve else "rejected"
            await self.notification_service.notify(
                user_ids=[cr.requested_by],
                title=f"Your change request was {('approved' if approve else 'rejected')}",
                message=(
                    f"Your request to {cr.action.lower()} a {cr.timetable_type} session for {course_label} "
                    f"was {outcome}.\n" + (f"Note: {note.strip()}" if note else "")
                ),
                link=f"/timetable/{'lectures' if cr.timetable_type == 'lecture' else 'exams'}",
                send_email=False,
            )

        await self.audit_service.log(
            current_user=current_user,
            action=f"change_request.{'approve' if approve else 'reject'}",
            entity_type="change_request",
            entity_id=cr.id,
            description=f"{'Approved' if approve else 'Rejected'} {cr.action.lower()} request for {course_label}",
            extra={"note": note},
        )
        return await self._enrich_change_request(cr)

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

    # ---------- Conflict Dismissals ----------

    def _assert_faculty_can_dismiss(self, current_user: dict, items: list[ScheduleItem]) -> None:
        """Global-scope roles may dismiss any conflict; a faculty editor may only
        dismiss conflicts that involve at least one of their faculty's items."""
        if _has_global_scope(current_user):
            return
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            fid = current_user.get("faculty_id")
            if fid and any(getattr(i, "faculty_id", None) == fid for i in items):
                return
        raise HTTPException(status_code=403, detail="You can only dismiss conflicts involving your faculty")

    async def get_dismissals(self, current_user: dict) -> list[ConflictDismissal]:
        return await self.repo.get_dismissals()

    async def create_dismissal(self, data: ConflictDismissalCreate, current_user: dict) -> ConflictDismissal:
        ctype, a_id, b_id = _normalize_signature(data.conflict_type, data.item_a_id, data.item_b_id)
        if b_id is not None and b_id == a_id:
            raise HTTPException(status_code=400, detail="A conflict must reference two different schedule items")
        ids = [a_id] + ([b_id] if b_id is not None else [])
        items = await self.repo.get_schedule_items_by_ids(ids)
        found = {i.id for i in items}
        for i in ids:
            if i not in found:
                raise HTTPException(status_code=404, detail=f"Schedule item {i} not found")
        self._assert_faculty_can_dismiss(current_user, items)

        existing = await self.repo.find_dismissal(ctype, a_id, b_id)
        if existing:
            return existing

        sub = current_user.get("sub")
        actor_id = int(sub) if sub is not None else None
        dismissal = ConflictDismissal(
            conflict_type=ctype, item_a_id=a_id, item_b_id=b_id,
            reason=data.reason.strip(), created_by=actor_id,
        )
        try:
            created = await self.repo.create_dismissal(dismissal)
        except IntegrityError:
            raise HTTPException(status_code=400, detail="This conflict is already dismissed")
        await self.audit_service.log(
            current_user=current_user,
            action="conflict.dismiss",
            entity_type="conflict_dismissal",
            entity_id=created.id,
            description=f"Dismissed {ctype} conflict for schedule item {a_id}"
            + (f" & {b_id}" if b_id is not None else ""),
            extra={"conflict_type": ctype, "item_a_id": a_id, "item_b_id": b_id, "reason": data.reason.strip()},
        )
        return created

    async def bulk_dismiss(self, data: ConflictDismissalBulkCreate, current_user: dict) -> list[ConflictDismissal]:
        dept = await self.repo.get_department(data.department_id)
        if not dept:
            raise HTTPException(status_code=404, detail="Department not found")
        if not _has_global_scope(current_user):
            if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
                fid = current_user.get("faculty_id")
                if not fid or dept.faculty_id != fid:
                    raise HTTPException(status_code=403, detail="You can only resolve conflicts for departments in your faculty")
            else:
                raise HTTPException(status_code=403, detail="Not authorized")

        all_ids = set()
        for s in data.dismissals:
            all_ids.add(s.item_a_id)
            if s.item_b_id is not None:
                all_ids.add(s.item_b_id)
        items = await self.repo.get_schedule_items_by_ids(list(all_ids))
        items_map = {i.id: i for i in items}
        existing = {(d.conflict_type, d.item_a_id, d.item_b_id) for d in await self.repo.get_dismissals()}

        sub = current_user.get("sub")
        actor_id = int(sub) if sub is not None else None
        reason = data.reason.strip()
        created: list[ConflictDismissal] = []
        for s in data.dismissals:
            ctype, a_id, b_id = _normalize_signature(s.conflict_type, s.item_a_id, s.item_b_id)
            if a_id not in items_map:
                continue
            if b_id is not None and (b_id not in items_map or b_id == a_id):
                continue
            involved = [items_map[a_id]] + ([items_map[b_id]] if b_id is not None else [])
            try:
                self._assert_faculty_can_dismiss(current_user, involved)
            except HTTPException:
                continue
            if (ctype, a_id, b_id) in existing:
                continue
            dismissal = ConflictDismissal(
                conflict_type=ctype, item_a_id=a_id, item_b_id=b_id,
                reason=reason, created_by=actor_id,
            )
            await self.repo.create_dismissal(dismissal)
            created.append(dismissal)
            existing.add((ctype, a_id, b_id))

        await self.audit_service.log(
            current_user=current_user,
            action="conflict.dismiss.bulk",
            entity_type="department",
            entity_id=data.department_id,
            description=f"Bulk-dismissed {len(created)} conflict(s) in department '{dept.name}'",
            extra={"department_id": data.department_id, "count": len(created), "reason": reason},
        )
        return created

    async def delete_dismissal(self, id: int, current_user: dict) -> None:
        dismissal = await self.repo.get_dismissal(id)
        if not dismissal:
            raise HTTPException(status_code=404, detail="Dismissal not found")
        ids = [dismissal.item_a_id] + ([dismissal.item_b_id] if dismissal.item_b_id is not None else [])
        items = await self.repo.get_schedule_items_by_ids(ids)
        self._assert_faculty_can_dismiss(current_user, items)
        ctype = dismissal.conflict_type
        item_a = dismissal.item_a_id
        await self.repo.delete_dismissal(dismissal)
        await self.audit_service.log(
            current_user=current_user,
            action="conflict.restore",
            entity_type="conflict_dismissal",
            entity_id=id,
            description=f"Restored {ctype} conflict for schedule item {item_a}",
            extra={"conflict_type": ctype},
        )
