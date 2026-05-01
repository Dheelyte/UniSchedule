from fastapi import APIRouter, Depends, Query
from typing import Optional, Literal
from modules.timetable.service import TimetableService
from modules.timetable.schemas import (
    FacultyCreate, FacultyResponse, FacultyUpdate,
    DepartmentCreate, DepartmentResponse, DepartmentUpdate,
    RoomCreate, RoomResponse, RoomUpdate,
    CourseCreate, CourseResponse, CourseUpdate,
    ScheduleItemCreate, ScheduleItemResponse, ScheduleItemUpdate,
    BlockedSlotCreate, BlockedSlotResponse, RoomReorderRequest,
    TimetableLockResponse, TimetableLockUpdate, EditRequestCreate,
    CourseEnrollmentCreate, CourseEnrollmentResponse,
)
from api.dependencies.auth import RequireRole, get_current_user
from modules.auth.models import RoleEnum

router = APIRouter(prefix="/timetable", tags=["Timetable"])

@router.post("/faculties", response_model=FacultyResponse)
async def create_fac(
    data: FacultyCreate, 
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))
):
    return await service.create_faculty(data, user)

@router.get("/faculties", response_model=list[FacultyResponse])
async def get_facs(
    all: bool = Query(False),
    service: TimetableService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.get_faculties(user, all=all)

@router.put("/faculties/{id}", response_model=FacultyResponse)
async def update_fac(
    id: str,
    data: FacultyUpdate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))
):
    return await service.update_faculty(id, data, user)

@router.delete("/faculties/{id}")
async def delete_fac(
    id: str,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))
):
    await service.delete_faculty(id, user)
    return {"message": "Deleted"}

@router.post("/departments", response_model=DepartmentResponse)
async def create_dept(
    data: DepartmentCreate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]))
):
    return await service.create_department(data, user)

@router.get("/departments", response_model=list[DepartmentResponse])
async def get_depts(
    all: bool = Query(False),
    service: TimetableService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.get_departments(user, all=all)

@router.put("/departments/{id}", response_model=DepartmentResponse)
async def update_dept(
    id: int,
    data: DepartmentUpdate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]))
):
    return await service.update_department(id, data, user)

@router.delete("/departments/{id}")
async def delete_dept(
    id: int,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]))
):
    await service.delete_department(id, user)
    return {"message": "Deleted"}

@router.post("/rooms", response_model=RoomResponse)
async def create_room(
    data: RoomCreate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value, RoleEnum.GS_ADMIN.value]))
):
    return await service.create_room(data, user)

@router.post("/rooms/reorder", response_model=list[RoomResponse])
async def reorder_rooms(
    data: RoomReorderRequest,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value, RoleEnum.GS_ADMIN.value]))
):
    return await service.reorder_rooms(data, user)

@router.get("/rooms", response_model=list[RoomResponse])
async def get_rooms(
    all: bool = Query(False),
    service: TimetableService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.get_rooms(user, all=all)

@router.put("/rooms/{id}", response_model=RoomResponse)
async def update_room(
    id: int,
    data: RoomUpdate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value, RoleEnum.GS_ADMIN.value]))
):
    return await service.update_room(id, data, user)

@router.delete("/rooms/{id}")
async def delete_room(
    id: int,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value, RoleEnum.GS_ADMIN.value]))
):
    await service.delete_room(id, user)
    return {"message": "Deleted"}

@router.post("/courses", response_model=CourseResponse)
async def create_course(
    data: CourseCreate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value, RoleEnum.GS_ADMIN.value]))
):
    return await service.create_course(data, user)

@router.get("/courses", response_model=list[CourseResponse])
async def get_courses(
    service: TimetableService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.get_courses(user)

@router.put("/courses/{id}", response_model=CourseResponse)
async def update_course(
    id: int,
    data: CourseUpdate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value, RoleEnum.GS_ADMIN.value]))
):
    return await service.update_course(id, data, user)

@router.delete("/courses/{id}")
async def delete_course(
    id: int,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value, RoleEnum.GS_ADMIN.value]))
):
    await service.delete_course(id, user)
    return {"message": "Deleted"}

@router.post("/schedule-items", response_model=ScheduleItemResponse)
async def create_schedule_item(
    data: ScheduleItemCreate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value, RoleEnum.GS_ADMIN.value]))
):
    return await service.create_schedule_item(data, user)

@router.get("/schedule-items", response_model=list[ScheduleItemResponse])
async def get_schedule_items(
    semester_id: Optional[int] = Query(None),
    service: TimetableService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.get_schedule_items(user, semester_id=semester_id)

@router.put("/schedule-items/{item_id}", response_model=ScheduleItemResponse)
async def update_schedule(
    item_id: int,
    data: ScheduleItemUpdate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value, RoleEnum.GS_ADMIN.value]))
):
    return await service.update_schedule_item(item_id, data, user)

@router.delete("/schedule-items/{item_id}")
async def delete_schedule(
    item_id: int,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value, RoleEnum.GS_ADMIN.value]))
):
    await service.delete_schedule_item(item_id, user)
    return {"message": "Deleted"}

# ---------- Blocked Slots ----------

@router.post("/blocked-slots", response_model=BlockedSlotResponse)
async def create_blocked_slot(
    data: BlockedSlotCreate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))
):
    return await service.create_blocked_slot(data, user)

@router.get("/blocked-slots", response_model=list[BlockedSlotResponse])
async def get_blocked_slots(
    semester_id: Optional[int] = Query(None),
    service: TimetableService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.get_blocked_slots(semester_id=semester_id)

@router.delete("/blocked-slots/{id}")
async def delete_blocked_slot(
    id: int,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value]))
):
    await service.delete_blocked_slot(id, user)
    return {"message": "Deleted"}

# ---------- Locks ----------

@router.get("/locks", response_model=list[TimetableLockResponse])
async def list_locks(
    semester_id: int = Query(...),
    service: TimetableService = Depends(),
    user: dict = Depends(get_current_user),
):
    return await service.list_locks(semester_id)

@router.put("/locks/{timetable_type}", response_model=TimetableLockResponse)
async def set_lock(
    timetable_type: Literal["lecture", "exam"],
    data: TimetableLockUpdate,
    semester_id: int = Query(...),
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value])),
):
    return await service.set_lock(semester_id, timetable_type, data.is_locked, user)

@router.post("/locks/{timetable_type}/edit-requests", status_code=204)
async def request_timetable_edit(
    timetable_type: Literal["lecture", "exam"],
    data: EditRequestCreate,
    semester_id: int = Query(...),
    service: TimetableService = Depends(),
    user: dict = Depends(get_current_user),
):
    await service.request_edit(semester_id, timetable_type, data.reason, user)
    return None

# ---------- Course Enrollments (per dept × level) ----------

@router.get("/enrollments", response_model=list[CourseEnrollmentResponse])
async def list_my_enrollments(
    service: TimetableService = Depends(),
    user: dict = Depends(get_current_user),
):
    return await service.list_enrollments(user)

@router.get("/courses/{course_id}/enrollments", response_model=list[CourseEnrollmentResponse])
async def list_course_enrollments(
    course_id: int,
    service: TimetableService = Depends(),
    user: dict = Depends(get_current_user),
):
    return await service.list_enrollments(user, course_id=course_id)

@router.post("/enrollments", response_model=CourseEnrollmentResponse, status_code=201)
async def create_enrollment(
    data: CourseEnrollmentCreate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value])),
):
    return await service.create_enrollment(data.course_id, data.department_id, data.level, user)

@router.delete("/enrollments", status_code=204)
async def delete_enrollment(
    course_id: int = Query(...),
    department_id: int = Query(...),
    level: int = Query(...),
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value])),
):
    await service.delete_enrollment(course_id, department_id, level, user)
    return None
