from fastapi import APIRouter, Depends, Query
from typing import Optional
from modules.timetable.service import TimetableService
from modules.timetable.schemas import (
    FacultyCreate, FacultyResponse, FacultyUpdate,
    DepartmentCreate, DepartmentResponse, DepartmentUpdate,
    RoomCreate, RoomResponse, RoomUpdate,
    CourseCreate, CourseResponse, CourseUpdate,
    ScheduleItemCreate, ScheduleItemResponse, ScheduleItemUpdate
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
    return await service.create_faculty(data)

@router.get("/faculties", response_model=list[FacultyResponse])
async def get_facs(
    service: TimetableService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.get_faculties(user)

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
    service: TimetableService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.get_departments(user)

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
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]))
):
    return await service.create_room(data, user)

@router.get("/rooms", response_model=list[RoomResponse])
async def get_rooms(
    service: TimetableService = Depends(),
    user: dict = Depends(get_current_user)
):
    return await service.get_rooms(user)

@router.put("/rooms/{id}", response_model=RoomResponse)
async def update_room(
    id: int,
    data: RoomUpdate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]))
):
    return await service.update_room(id, data, user)

@router.delete("/rooms/{id}")
async def delete_room(
    id: int,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]))
):
    await service.delete_room(id, user)
    return {"message": "Deleted"}

@router.post("/courses", response_model=CourseResponse)
async def create_course(
    data: CourseCreate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]))
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
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]))
):
    return await service.update_course(id, data, user)

@router.delete("/courses/{id}")
async def delete_course(
    id: int,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]))
):
    await service.delete_course(id, user)
    return {"message": "Deleted"}

@router.post("/schedule-items", response_model=ScheduleItemResponse)
async def create_schedule_item(
    data: ScheduleItemCreate,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]))
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
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]))
):
    return await service.update_schedule_item(item_id, data, user)

@router.delete("/schedule-items/{item_id}")
async def delete_schedule(
    item_id: int,
    service: TimetableService = Depends(),
    user: dict = Depends(RequireRole([RoleEnum.SUPER_ADMIN.value, RoleEnum.FACULTY_EDITOR.value]))
):
    await service.delete_schedule_item(item_id, user)
    return {"message": "Deleted"}
