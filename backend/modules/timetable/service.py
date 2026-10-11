from fastapi import Depends, HTTPException
from datetime import date, datetime, timezone
from modules.timetable.repository import TimetableRepository
from modules.calendar.repository import CalendarRepository
from modules.timetable.models import Faculty, Room, Course, ScheduleItem, Department, CourseScope, BlockedSlot, TimetableLock, CourseEnrollment, ChangeRequest, ChangeRequestAction, ChangeRequestStatus, ConflictDismissal
from modules.timetable.schemas import (
    FacultyCreate, RoomCreate, CourseCreate, ScheduleItemCreate, DepartmentCreate, ScheduleItemUpdate,
    FacultyUpdate, DepartmentUpdate, RoomUpdate, CourseUpdate, BlockedSlotCreate, RoomReorderRequest,
    ChangeRequestCreate, ConflictDismissalCreate, ConflictDismissalBulkCreate, RoomCatalogueAddRequest,
)
from modules.auth.models import RoleEnum, CROSS_REALM_ROLES
from modules.auth.repository import AuthRepository
from modules.realms.defaults import DEFAULT_REALM_KEY
from modules.realms.schemas import WEEKDAYS
from modules.notifications.service import NotificationService
from modules.audit.service import AuditService
from sqlalchemy.exc import IntegrityError


# The realm whose rooms the other realms pick their halls from ("Add from Undergraduate").
ROOM_CATALOGUE_REALM = DEFAULT_REALM_KEY


def _has_global_scope(user: dict) -> bool:
    return user.get("role") in (RoleEnum.SUPER_ADMIN.value, RoleEnum.SUPER_VIEWER.value, RoleEnum.GS_ADMIN.value, RoleEnum.CITS_ADMIN.value)


def _has_global_read_scope(user: dict) -> bool:
    return user.get("role") in (
        RoleEnum.SUPER_ADMIN.value,
        RoleEnum.SUPER_VIEWER.value,
        RoleEnum.GS_ADMIN.value,
        RoleEnum.FACULTY_EDITOR.value,
        RoleEnum.FACULTY_VIEWER.value,
        RoleEnum.DEO.value,
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


def _for_super_admins(current_user: dict, title: str, link: str) -> tuple[str, str]:
    """Super admins work across realms, so a notification to them names the
    realm in its title and carries it on its link."""
    return f"{current_user['realm_name']}: {title}", f"{link}?realm={current_user['realm']}"


def _assert_course_fits_realm(current_user: dict, level: int | None, semester: str | None) -> None:
    """Levels and semester names come from the realm config, which the request schemas can't see."""
    config = current_user["realm_config"]
    if level is not None and level not in config["levels"]:
        raise HTTPException(status_code=400, detail=f"level must be one of: {', '.join(str(l) for l in config['levels'])}")
    if semester is not None and semester not in config["semester_names"]:
        raise HTTPException(status_code=400, detail=f"semester must be one of: {', '.join(config['semester_names'])}")


def _clock_minutes(value) -> int:
    return value.hour * 60 + value.minute


def _config_minutes(value: str) -> int:
    hours, minutes = value.split(":")
    return int(hours) * 60 + int(minutes)


def _assert_day_allowed(current_user: dict, kind: str, day: str | None) -> None:
    """In a strict realm, `day` must be one of the realm's lecture or exam days."""
    config = current_user["realm_config"]
    if not config["strict"]:
        return
    allowed = config["exam_days"] if kind == "exam" else config["lecture_days"]
    if day not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"{current_user['realm_name']} {kind}s run on {', '.join(allowed)} only",
        )


def _assert_fits_window(current_user: dict, item_type: str, day_of_week: str | None, exam_date: date | None, start_time, end_time) -> None:
    """In a strict realm, a session must sit on the realm's days, inside its day
    window and on its time grid. Other realms are only flagged in the UI."""
    config = current_user["realm_config"]
    if not config["strict"]:
        return
    if item_type == "exam":
        day = WEEKDAYS[exam_date.weekday()] if exam_date else day_of_week
        _assert_day_allowed(current_user, "exam", day)
    else:
        _assert_day_allowed(current_user, "lecture", day_of_week)

    if end_time <= start_time:
        raise HTTPException(status_code=400, detail="End time must be after start time")
    day_start, day_end = _config_minutes(config["day_start"]), _config_minutes(config["day_end"])
    start, end = _clock_minutes(start_time), _clock_minutes(end_time)
    if start < day_start or end > day_end:
        raise HTTPException(
            status_code=400,
            detail=f"{current_user['realm_name']} sessions must be within {config['day_start']}–{config['day_end']}",
        )
    step = config["slot_minutes"]
    off_grid = any(
        (_clock_minutes(t) - day_start) % step or t.second or t.microsecond for t in (start_time, end_time)
    )
    if off_grid:
        raise HTTPException(status_code=400, detail=f"Start and end times must be in {step}-minute steps")


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
        
    async def _semester_in_realm(self, semester_id: int, current_user: dict):
        """The semester, or 404 when it isn't one of the active realm's."""
        semester = await self.cal_repo.get_semester(semester_id, realm_key=current_user["realm"])
        if not semester:
            raise HTTPException(status_code=404, detail="Semester not found")
        return semester

    async def _faculty_in_realm(self, faculty_id: str, current_user: dict) -> Faculty:
        """The faculty, or 404 when it isn't one of the active realm's."""
        faculty = await self.repo.get_faculty(faculty_id, realm_key=current_user["realm"])
        if not faculty:
            raise HTTPException(status_code=404, detail="Faculty not found")
        return faculty

    async def create_faculty(self, data: FacultyCreate, current_user: dict) -> Faculty:
        realm_key = current_user["realm"]
        # Faculty ids are unique across realms. UG keeps the id it sends, as it
        # always has; another realm's ids carry its key, so they never take a UG id.
        faculty_id = data.id if realm_key == DEFAULT_REALM_KEY else f"{realm_key}-{data.id}"
        if await self.repo.faculty_id_exists(faculty_id):
            raise HTTPException(status_code=400, detail="A faculty with this id already exists. Please try again.")
        faculty = Faculty(id=faculty_id, name=data.name, is_special=data.is_special, realm_key=realm_key)
        try:
            created = await self.repo.create_faculty(faculty)
        except IntegrityError:
            raise HTTPException(status_code=400, detail=f"Faculty '{data.name}' already exists.")
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
            return await self.repo.get_faculties(realm_key=current_user["realm"])
        faculty_id = None if _has_global_scope(current_user) else current_user.get('faculty_id')
        return await self.repo.get_faculties(realm_key=current_user["realm"], faculty_id=faculty_id)

    async def update_faculty(self, id: str, data: FacultyUpdate, current_user: dict) -> Faculty:
        if current_user.get("role") != RoleEnum.SUPER_ADMIN.value:
            raise HTTPException(status_code=403, detail="Not authorized")
        faculty = await self._faculty_in_realm(id, current_user)
        if data.name is not None: faculty.name = data.name
        if data.is_special is not None: faculty.is_special = data.is_special
        try:
            updated = await self.repo.update_faculty(faculty)
        except IntegrityError:
            raise HTTPException(status_code=400, detail=f"Faculty '{data.name}' already exists.")
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
        faculty = await self.repo.get_faculty(id, realm_key=current_user["realm"])
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
        await self._faculty_in_realm(data.faculty_id, current_user)
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
            return await self.repo.get_departments(realm_key=current_user["realm"])
        faculty_id = None if _has_global_scope(current_user) else current_user.get('faculty_id')
        return await self.repo.get_departments(realm_key=current_user["realm"], faculty_id=faculty_id)

    async def update_department(self, id: int, data: DepartmentUpdate, current_user: dict) -> Department:
        dept = await self.repo.get_department(id, realm_key=current_user["realm"])
        if not dept: raise HTTPException(status_code=404, detail="Not found")
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != dept.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
        if data.name is not None: dept.name = data.name
        if data.faculty_id is not None:
            if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value and current_user.get("faculty_id") != data.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
            await self._faculty_in_realm(data.faculty_id, current_user)
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
        dept = await self.repo.get_department(id, realm_key=current_user["realm"])
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
        # A faculty room is bound to a faculty of its own realm.
        if data.faculty_id is not None:
            await self._faculty_in_realm(data.faculty_id, current_user)
        active_seats = max(0, data.active_seats or 0)
        inactive_seats = max(0, data.inactive_seats or 0)
        room = Room(
            name=data.name,
            realm_key=current_user["realm"],
            capacity=active_seats + inactive_seats,
            active_seats=active_seats,
            inactive_seats=inactive_seats,
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
            rooms = await self.repo.get_rooms(realm_key=current_user["realm"])
        else:
            faculty_id = None if _has_global_scope(current_user) else current_user.get('faculty_id')
            rooms = await self.repo.get_rooms(realm_key=current_user["realm"], faculty_id=faculty_id)
        return await self._with_linked_rooms(rooms, current_user)

    async def _with_linked_rooms(self, rooms: list[Room], current_user: dict) -> list[Room]:
        """Attach, for each room in a hall group, the other realms' rooms that are the same hall."""
        grouped = [room.id for room in rooms if room.hall_group_id is not None]
        if not grouped:
            return rooms
        by_room: dict[int, list[dict]] = {}
        for link in await self.repo.get_linked_rooms(realm_key=current_user["realm"], room_ids=grouped):
            by_room.setdefault(link["room_id"], []).append({
                "room_id": link["linked_room_id"], "name": link["name"],
                "realm_key": link["realm_key"], "realm_name": link["realm_name"],
            })
        for room in rooms:
            room.linked_rooms = by_room.get(room.id, [])
        return rooms

    async def update_room(self, id: int, data: RoomUpdate, current_user: dict) -> Room:
        room = await self.repo.get_room(id, realm_key=current_user["realm"])
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
        if data.active_seats is not None: room.active_seats = max(0, data.active_seats)
        if data.inactive_seats is not None: room.inactive_seats = max(0, data.inactive_seats)
        # Keep total capacity in sync with the seat breakdown.
        if data.active_seats is not None or data.inactive_seats is not None:
            room.capacity = (room.active_seats or 0) + (room.inactive_seats or 0)
        elif data.capacity is not None:
            room.capacity = data.capacity
        if data.is_lab is not None: room.is_lab = data.is_lab
        if data.faculty_id is not None:
            if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value and current_user.get("faculty_id") != data.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
            await self._faculty_in_realm(data.faculty_id, current_user)
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
        return (await self._with_linked_rooms([updated], current_user))[0]

    async def delete_room(self, id: int, current_user: dict) -> None:
        room = await self.repo.get_room(id, realm_key=current_user["realm"])
        if not room: return
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != room.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized")
        if _is_gs_admin(current_user) and room.faculty_id is not None:
            raise HTTPException(status_code=403, detail="General Studies admins cannot delete rooms bound to a faculty")

        # Only this realm's sessions use the room. A room in the same hall group
        # in another realm is a separate room and is left as it is.
        is_referenced = await self.repo.is_room_referenced_by_schedule(id, realm_key=current_user["realm"])
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
            room = await self.repo.get_room(room_id, realm_key=current_user["realm"])
            if room:
                if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value and current_user.get("faculty_id") != room.faculty_id:
                    continue # Skip rooms outside their faculty natively
                if _is_gs_admin(current_user) and room.faculty_id is not None:
                    continue # GS admins reorder only general rooms
                room.display_order = new_order
                updated_rooms.append(room)
                
        await self.repo.db.flush()
        return updated_rooms

    # ---------- Hall groups: the same physical hall in more than one realm ----------

    async def get_other_realm_rooms(self, source_realm_key: str, current_user: dict) -> list[dict]:
        """Another realm's rooms, each with this realm's room for the same hall, if any."""
        realm_key = current_user["realm"]
        rooms = await self.repo.get_other_realm_rooms(realm_key=realm_key, source_realm_key=source_realm_key)
        own_room_of = {
            link["linked_room_id"]: link["room_id"] for link in await self.repo.get_linked_rooms(realm_key=realm_key)
        }
        return [
            {
                "id": room.id, "name": room.name, "realm_key": room.realm_key,
                "capacity": room.capacity, "active_seats": room.active_seats, "inactive_seats": room.inactive_seats,
                "is_lab": room.is_lab, "is_active": room.is_active,
                "linked_room_id": own_room_of.get(room.id),
            }
            for room in rooms
        ]

    async def get_room_catalogue(self, current_user: dict) -> dict:
        """The catalogue realm's rooms, read-only, for a realm choosing which of
        those halls it also uses. Each says whether this realm already added it.
        The catalogue realm itself has nothing to pick from."""
        realm_key = current_user["realm"]
        catalogue = {
            "realm_key": ROOM_CATALOGUE_REALM,
            "realm_name": await self.repo.get_realm_name(ROOM_CATALOGUE_REALM) or ROOM_CATALOGUE_REALM,
            "rooms": [],
        }
        if realm_key == ROOM_CATALOGUE_REALM:
            return catalogue
        faculty_names = {f.id: f.name for f in await self.repo.get_faculties(realm_key=ROOM_CATALOGUE_REALM)}
        added = {
            link["linked_room_id"]: link for link in await self.repo.get_linked_rooms(realm_key=realm_key)
            if link["realm_key"] == ROOM_CATALOGUE_REALM
        }
        own_names = {room.id: room.name for room in await self.repo.get_rooms(realm_key=realm_key)}
        for room in await self.repo.get_other_realm_rooms(realm_key=realm_key, source_realm_key=ROOM_CATALOGUE_REALM):
            link = added.get(room.id)
            catalogue["rooms"].append({
                "id": room.id, "name": room.name, "faculty_name": faculty_names.get(room.faculty_id),
                "capacity": room.capacity, "active_seats": room.active_seats, "inactive_seats": room.inactive_seats,
                "is_lab": room.is_lab, "is_active": room.is_active,
                "added_room_id": link["room_id"] if link else None,
                "added_room_name": own_names.get(link["room_id"]) if link else None,
            })
        return catalogue

    async def add_rooms_from_catalogue(self, data: RoomCatalogueAddRequest, current_user: dict) -> dict:
        """Add catalogue rooms to this realm as rooms of its own. Each new room
        keeps the name, seats and lab flag, takes the faculty chosen for it
        (one of this realm's, or none) and joins its original's hall group, so
        the two realms' bookings of that hall are checked against each other.
        A hall this realm already has a room for is skipped: it is added once."""
        realm_key = current_user["realm"]
        if realm_key == ROOM_CATALOGUE_REALM:
            raise HTTPException(status_code=400, detail="This programme's rooms are the catalogue; there is nothing to add from.")
        role = current_user.get("role")
        for item in data.rooms:
            # The same rules as creating a room by hand.
            if role == RoleEnum.FACULTY_EDITOR.value and current_user.get("faculty_id") != item.faculty_id:
                raise HTTPException(status_code=403, detail="Not authorized to bind this resource off-scope")
            if _is_gs_admin(current_user) and item.faculty_id is not None:
                raise HTTPException(status_code=403, detail="General Studies admins can only create rooms not bound to a faculty")
            if item.faculty_id is not None:
                await self._faculty_in_realm(item.faculty_id, current_user)

        sources = {
            room.id: room
            for room in await self.repo.get_other_realm_rooms(realm_key=realm_key, source_realm_key=ROOM_CATALOGUE_REALM)
        }
        added, skipped = [], []
        for item in {item.room_id: item for item in data.rooms}.values():
            source = sources.get(item.room_id)
            if source is None:
                skipped.append({"room_id": item.room_id, "name": None, "reason": "Room not found"})
                continue
            if source.hall_group_id is not None:
                existing = await self.repo.get_room_in_hall_group(source.hall_group_id, realm_key=realm_key)
                if existing:
                    skipped.append({"room_id": source.id, "name": source.name, "reason": f"Already added as '{existing.name}'"})
                    continue
            if item.faculty_id is not None and await self.repo.is_room_name_taken(source.name, item.faculty_id, realm_key=realm_key):
                skipped.append({"room_id": source.id, "name": source.name, "reason": "A room with this name already exists in that faculty"})
                continue
            if source.hall_group_id is None:
                # Joining a hall group is the one thing this does to the original room.
                source.hall_group_id = (await self.repo.create_hall_group()).id
            added.append(await self.repo.create_room(Room(
                name=source.name,
                realm_key=realm_key,
                faculty_id=item.faculty_id,
                hall_group_id=source.hall_group_id,
                capacity=source.capacity,
                active_seats=source.active_seats,
                inactive_seats=source.inactive_seats,
                is_lab=source.is_lab,
                display_order=source.display_order,
                is_active=True,
            )))
        if added:
            await self.audit_service.log(
                current_user=current_user,
                action="room.add_from_catalogue",
                entity_type="room",
                description=f"Added {len(added)} room(s) from {ROOM_CATALOGUE_REALM}: {', '.join(room.name for room in added)}",
                extra={"source_realm": ROOM_CATALOGUE_REALM, "room_ids": [room.id for room in added]},
            )
        return {"added": await self._with_linked_rooms(added, current_user), "skipped": skipped}

    async def set_room_hall(self, id: int, other_room_id: int, current_user: dict) -> Room:
        """Mark this realm's room as the same physical hall as another realm's room."""
        realm_key = current_user["realm"]
        room = await self.repo.get_room(id, realm_key=realm_key)
        if not room: raise HTTPException(status_code=404, detail="Not found")
        other = await self.repo.get_room_outside_realm(other_room_id, realm_key=realm_key)
        if not other: raise HTTPException(status_code=404, detail="Room not found")

        if other.hall_group_id is None:
            # A group holds one room per realm: if this room's group already has
            # one of that realm's, this room leaves it for a new group of two.
            if room.hall_group_id is None or await self.repo.get_room_in_hall_group(room.hall_group_id, realm_key=other.realm_key):
                room.hall_group_id = (await self.repo.create_hall_group()).id
            other.hall_group_id = room.hall_group_id
        else:
            occupant = await self.repo.get_room_in_hall_group(other.hall_group_id, realm_key=realm_key)
            if occupant and occupant.id != room.id:
                raise HTTPException(status_code=409, detail=f"'{other.name}' is already linked to '{occupant.name}'. Unlink that room first.")
            # Leaving its previous group, if it had one, changes nothing for the rooms that stay.
            room.hall_group_id = other.hall_group_id
        await self.repo.db.flush()
        await self.audit_service.log(
            current_user=current_user,
            action="room.hall.link",
            entity_type="room",
            entity_id=room.id,
            description=f"Linked room {room.id} ({room.name}) to {other.realm_key} room {other.id} ({other.name}) as one hall",
            extra={"other_room_id": other.id, "other_realm": other.realm_key, "hall_group_id": room.hall_group_id},
        )
        return (await self._with_linked_rooms([room], current_user))[0]

    async def clear_room_hall(self, id: int, current_user: dict) -> Room:
        """Take this realm's room out of its hall group. The other rooms stay in it."""
        room = await self.repo.get_room(id, realm_key=current_user["realm"])
        if not room: raise HTTPException(status_code=404, detail="Not found")
        if room.hall_group_id is not None:
            hall_group_id = room.hall_group_id
            room.hall_group_id = None
            room.linked_rooms = []
            await self.repo.db.flush()
            await self.audit_service.log(
                current_user=current_user,
                action="room.hall.unlink",
                entity_type="room",
                entity_id=room.id,
                description=f"Unlinked room {room.id} ({room.name}) from its hall",
                extra={"hall_group_id": hall_group_id},
            )
        return room

    async def create_course(self, data: CourseCreate, current_user: dict) -> Course:
        # GS admins can ONLY create university-wide courses
        if _is_gs_admin(current_user) and data.scope != CourseScope.UNIVERSITY_WIDE.value:
            raise HTTPException(status_code=403, detail="General Studies admins can only create university-wide courses")
        # Only Super Admins and GS admins can create university-wide courses
        if data.scope == CourseScope.UNIVERSITY_WIDE.value:
            if current_user.get("role") not in (RoleEnum.SUPER_ADMIN.value, RoleEnum.GS_ADMIN.value):
                raise HTTPException(status_code=403, detail="Only Super Admins or General Studies admins can create university-wide courses")
        # Faculty editors may only add courses to departments within their own faculty
        if data.department_id is not None:
            dept = await self.repo.get_department(data.department_id, realm_key=current_user["realm"])
            if not dept:
                raise HTTPException(status_code=400, detail="Department not found")
            if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value and dept.faculty_id != current_user.get("faculty_id"):
                raise HTTPException(status_code=403, detail="Faculty editors can only add courses to departments in their own faculty")
        _assert_course_fits_realm(current_user, data.level, data.semester)
        course = Course(
            code=data.code,
            realm_key=current_user["realm"],
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
        prioritize_faculty_id = current_user.get('faculty_id')
        return await self.repo.get_courses(realm_key=current_user["realm"], faculty_id=faculty_id, prioritize_faculty_id=prioritize_faculty_id)

    async def update_course(self, id: int, data: CourseUpdate, current_user: dict) -> Course:
        course = await self.repo.get_course(id, realm_key=current_user["realm"])
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
            current_dept = await self.repo.get_department(course.department_id, realm_key=current_user["realm"]) if course.department_id else None
            if current_dept and current_dept.faculty_id != user_faculty:
                raise HTTPException(status_code=403, detail="Faculty editors can only edit courses in their own faculty")
        if data.department_id is not None:
            target_dept = await self.repo.get_department(data.department_id, realm_key=current_user["realm"])
            if not target_dept:
                raise HTTPException(status_code=400, detail="Department not found")
            if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value and target_dept.faculty_id != current_user.get("faculty_id"):
                raise HTTPException(status_code=403, detail="Faculty editors can only assign courses to departments in their own faculty")
        _assert_course_fits_realm(current_user, data.level, data.semester)
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
        # Another realm's course is not found here, so like a missing id it is a silent no-op.
        course = await self.repo.get_course(id, realm_key=current_user["realm"])
        if course:
            if _is_gs_admin(current_user) and course.scope != CourseScope.UNIVERSITY_WIDE:
                raise HTTPException(status_code=403, detail="General Studies admins can only delete university-wide courses")
            
            is_referenced = await self.repo.is_course_referenced_by_schedule(id, realm_key=current_user["realm"])
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

    async def _check_blocked_slots(self, item_type: str, day_of_week: str | None, exam_date: date | None, start_time, end_time, semester_id: int, realm_key: str):
        """Raise HTTPException if the proposed time overlaps any blocked slot."""
        if item_type == "exam" and exam_date:
            day_of_week = exam_date.strftime("%A")
            
        blocked = await self.repo.get_relevant_blocked_slots(semester_id, day_of_week, exam_date, realm_key=realm_key)
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
        realm_key = new_item.realm_key
        new_course = await self.repo.get_course(new_item.course_id, realm_key=realm_key)
        if not new_course:
            return
        new_priority = _scope_priority(new_course.scope)
        if new_priority <= 1:
            return  # Departmental items can't override anything

        sem_id = new_item.semester_id
        if sem_id is None:
            current_sem = await self.cal_repo.get_current_semester(realm_key=realm_key)
            sem_id = current_sem.id if current_sem else None
        if sem_id is None:
            return
        siblings = await self.repo.get_schedule_items(realm_key=realm_key, semester_id=sem_id)

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

            other_course = await self.repo.get_course(s.course_id, realm_key=realm_key)
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
                dept = await self.repo.get_department(c.department_id, realm_key=realm_key)
                if dept and dept.faculty_id:
                    faculty_ids.add(dept.faculty_id)

        if not faculty_ids:
            return
        # Only this realm's editors: the same faculty has different editors per realm.
        editors = await self.auth_repo.get_faculty_editors_in_faculties(list(faculty_ids), realm_key=realm_key)
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

    async def _assert_not_locked(self, semester_id: int | None, item_type: str, realm_key: str) -> None:
        if semester_id is None:
            return
        lock = await self.repo.get_lock(semester_id, item_type, realm_key=realm_key)
        if lock and lock.is_locked:
            raise HTTPException(status_code=423, detail=f"This {item_type} timetable is locked.")

    async def _assert_rooms_active(self, room_ids: list[int] | None, realm_key: str, already_assigned_ids: list[int] | None = None) -> None:
        """Newly assigned rooms must be active rooms of the realm."""
        already_assigned_ids = already_assigned_ids or []
        new_ids = [rid for rid in (room_ids or []) if rid not in already_assigned_ids]
        if not new_ids:
            return
        rooms = await self.repo.get_rooms_by_ids(new_ids, realm_key=realm_key)
        # Another realm's room is not a room here, even when it is the same hall.
        if len(rooms) < len(set(new_ids)):
            raise HTTPException(status_code=400, detail="Room not found")
        inactive = [r.name for r in rooms if r.is_active is False]
        if inactive:
            raise HTTPException(status_code=400, detail=f"Cannot schedule into inactive room(s): {', '.join(inactive)}")

    async def _assert_no_cross_realm_clash(
        self,
        *,
        realm_key: str,
        semester_id: int | None,
        item_type: str,
        day_of_week: str | None,
        exam_date: date | None,
        start_time,
        end_time,
        room_ids: list[int] | None,
        faculty_id: str | None,
    ) -> None:
        """409 when another realm already holds the same physical hall (a room
        in the same hall group as one of these) for a same-type session at an
        overlapping time. It can't be dismissed - one of the two sessions has
        to move. Rooms that are in no hall group never clash across realms."""
        slot = exam_date if item_type == "exam" else day_of_week
        if not room_ids or slot is None:
            return
        # Only sessions in each realm's current semester hold a room.
        current_sem = await self.cal_repo.get_current_semester(realm_key=realm_key)
        if not current_sem or semester_id != current_sem.id:
            return
        # Special faculties are exempt, as they are within a realm.
        if faculty_id:
            faculty = await self.repo.get_faculty(faculty_id, realm_key=realm_key)
            if faculty and faculty.is_special:
                return

        others = await self.repo.get_other_realms_current_items(
            realm_key=realm_key,
            item_type=item_type,
            day_of_week=day_of_week if item_type != "exam" else None,
            exam_date=exam_date if item_type == "exam" else None,
        )
        for other in others:
            if other["is_special_faculty"]:
                continue
            shared = sorted(set(room_ids) & set(other["room_ids"]))
            if not shared or not _times_overlap(start_time, end_time, other["start_time"], other["end_time"]):
                continue
            rooms = await self.repo.get_rooms_by_ids(shared, realm_key=realm_key)
            room_names = ", ".join(r.name for r in rooms) or f"#{shared[0]}"
            when = other["exam_date"].strftime("%d %b %Y") if item_type == "exam" else other["day_of_week"]
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Room {room_names} is already booked by {other['realm_name']} for {other['course_code']} "
                    f"on {when} {other['start_time'].strftime('%H:%M')}–{other['end_time'].strftime('%H:%M')}. "
                    f"One of the two sessions has to move."
                ),
            )

    async def get_external_bookings(self, current_user: dict) -> list[dict]:
        return await self.repo.get_other_realms_current_items(realm_key=current_user["realm"])

    async def create_schedule_item(self, data: ScheduleItemCreate, current_user: dict) -> ScheduleItem:
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != data.faculty_id:
                raise HTTPException(status_code=403, detail="Strictly forbidden to schedule outside assigned faculty")
        if _is_gs_admin(current_user):
            course = await self.repo.get_course(data.course_id, realm_key=current_user["realm"])
            if not course or course.scope != CourseScope.UNIVERSITY_WIDE:
                raise HTTPException(status_code=403, detail="General Studies admins can only schedule university-wide courses")
            data.faculty_id = None

        # Verify schedule targets the current semester
        current_sem = await self.cal_repo.get_current_semester(realm_key=current_user["realm"])
        if not current_sem:
            raise HTTPException(status_code=400, detail="No active semester found. Please create a current semester before scheduling.")
        if data.semester_id is not None and data.semester_id != current_sem.id:
            raise HTTPException(status_code=403, detail="You can only schedule courses for the current semester.")

        sem_id = data.semester_id or current_sem.id
        if not await self.repo.get_course(data.course_id, realm_key=current_user["realm"]):
            raise HTTPException(status_code=404, detail="Course not found")
        await self._assert_not_locked(sem_id, data.type, current_user["realm"])
        exam_date_val = getattr(data, 'exam_date', None)
        _assert_fits_window(current_user, data.type, data.day_of_week, exam_date_val, data.start_time, data.end_time)
        await self._check_blocked_slots(data.type, data.day_of_week, exam_date_val, data.start_time, data.end_time, sem_id, current_user["realm"])
        if data.faculty_id is not None:
            await self._faculty_in_realm(data.faculty_id, current_user)
        await self._assert_rooms_active(data.room_ids, current_user["realm"])
        await self._assert_no_cross_realm_clash(
            realm_key=current_user["realm"], semester_id=sem_id, item_type=data.type,
            day_of_week=data.day_of_week, exam_date=exam_date_val,
            start_time=data.start_time, end_time=data.end_time,
            # An online session holds no room.
            room_ids=[] if data.is_online else data.room_ids, faculty_id=data.faculty_id,
        )

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
            realm_key=current_user["realm"],
            is_online=data.is_online,
        )
        created = await self.repo.create_schedule_item(item)
        await self._notify_priority_overrides(created)
        course = await self.repo.get_course(created.course_id, realm_key=current_user["realm"])
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
        return await self.repo.get_schedule_items(realm_key=current_user["realm"], semester_id=semester_id, faculty_id=faculty_id)
        
    async def update_schedule_item(self, id: int, data: ScheduleItemUpdate, current_user: dict) -> ScheduleItem:
        item = await self.repo.get_schedule_item(id, realm_key=current_user["realm"])
        if not item:
            raise HTTPException(status_code=404, detail="Schedule missing")
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != item.faculty_id:
                raise HTTPException(status_code=403, detail="Forbidden update")
        if _is_gs_admin(current_user):
            course = await self.repo.get_course(item.course_id, realm_key=current_user["realm"])
            if not course or course.scope != CourseScope.UNIVERSITY_WIDE:
                raise HTTPException(status_code=403, detail="General Studies admins can only edit university-wide schedule items")
        await self._assert_not_locked(item.semester_id, item.type, current_user["realm"])
        # Check blocked slots if day or time is changing
        new_day = data.day_of_week if data.day_of_week is not None else item.day_of_week
        new_exam_date = getattr(data, 'exam_date', None) if getattr(data, 'exam_date', None) is not None else getattr(item, 'exam_date', None)
        new_start = data.start_time or item.start_time
        new_end = data.end_time or item.end_time
        new_online = data.is_online if data.is_online is not None else item.is_online
        _assert_fits_window(current_user, item.type, new_day, new_exam_date, new_start, new_end)
        if item.semester_id:
            await self._check_blocked_slots(item.type, new_day, new_exam_date, new_start, new_end, item.semester_id, current_user["realm"])
        await self._assert_no_cross_realm_clash(
            realm_key=current_user["realm"], semester_id=item.semester_id, item_type=item.type,
            day_of_week=new_day, exam_date=new_exam_date, start_time=new_start, end_time=new_end,
            room_ids=[] if new_online else (data.room_ids if data.room_ids is not None else item.room_ids),
            faculty_id=item.faculty_id,
        )
        if data.room_ids is not None:
            await self._assert_rooms_active(data.room_ids, current_user["realm"], already_assigned_ids=item.room_ids or [])
            item.room_ids = data.room_ids
        if data.day_of_week is not None: item.day_of_week = data.day_of_week
        if data.exam_date is not None: item.exam_date = data.exam_date
        if data.start_time is not None: item.start_time = data.start_time
        if data.end_time is not None: item.end_time = data.end_time
        if data.is_online is not None: item.is_online = data.is_online
        updated = await self.repo.update_schedule_item(item)
        await self._notify_priority_overrides(updated)
        course = await self.repo.get_course(updated.course_id, realm_key=current_user["realm"])
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
        # Another realm's item is not found here, so like a missing id it is a silent no-op.
        item = await self.repo.get_schedule_item(id, realm_key=current_user["realm"])
        if not item: return
        if current_user.get("role") == RoleEnum.FACULTY_EDITOR.value:
            if current_user.get("faculty_id") != item.faculty_id:
                raise HTTPException(status_code=403, detail="Forbidden delete")
        if _is_gs_admin(current_user):
            course = await self.repo.get_course(item.course_id, realm_key=current_user["realm"])
            if not course or course.scope != CourseScope.UNIVERSITY_WIDE:
                raise HTTPException(status_code=403, detail="General Studies admins can only delete university-wide schedule items")
        await self._assert_not_locked(item.semester_id, item.type, current_user["realm"])
        course = await self.repo.get_course(item.course_id, realm_key=current_user["realm"])
        await self.repo.delete_schedule_item(item)
        await self.audit_service.log(
            current_user=current_user,
            action=f"schedule_item.{item.type}.delete",
            entity_type="schedule_item",
            entity_id=item.id,
            description=f"Removed {item.type} for {course.code if course else f'course #{item.course_id}'} from {item.exam_date or item.day_of_week} {item.start_time}-{item.end_time}",
        )

    # ---------- Blocked Slots ----------

    async def create_blocked_slot(self, data: BlockedSlotCreate, current_user: dict) -> BlockedSlot:
        await self._semester_in_realm(data.semester_id, current_user)
        config = current_user["realm_config"]
        if config["strict"]:
            if data.applies_to == "EXAM_ONLY":
                _assert_day_allowed(current_user, "exam", WEEKDAYS[data.date.weekday()])
            elif data.applies_to == "LECTURE_ONLY" or data.day_of_week not in config["exam_days"]:
                # A block for both timetables may sit on a day either of them uses.
                _assert_day_allowed(current_user, "lecture", data.day_of_week)
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

    async def get_blocked_slots(self, current_user: dict, semester_id: int | None = None) -> list[BlockedSlot]:
        realm_key = current_user["realm"]
        if semester_id is None:
            # No semester named: the realm's current one.
            current_sem = await self.cal_repo.get_current_semester(realm_key=realm_key)
            if not current_sem:
                return []
            semester_id = current_sem.id
        return await self.repo.get_blocked_slots(realm_key=realm_key, semester_id=semester_id)

    async def delete_blocked_slot(self, id: int, current_user: dict) -> None:
        slot = await self.repo.get_blocked_slot(id, realm_key=current_user["realm"])
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

    async def list_locks(self, semester_id: int, current_user: dict) -> list[TimetableLock]:
        await self._semester_in_realm(semester_id, current_user)
        existing = await self.repo.list_locks(semester_id, realm_key=current_user["realm"])
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
        await self._semester_in_realm(semester_id, current_user)
        sub = current_user.get("sub")
        user_id = int(sub) if sub is not None else None
        try:
            lock = await self.repo.upsert_lock(semester_id, timetable_type, is_locked, user_id, realm_key=current_user["realm"])
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
        await self._semester_in_realm(semester_id, current_user)

        lock = await self.repo.get_lock(semester_id, timetable_type, realm_key=current_user["realm"])
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
        title, link = _for_super_admins(current_user, title, link)

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
        course = await self.repo.get_course(cr.course_id, realm_key=cr.realm_key) if cr.course_id is not None else None
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
        # A course whose home department belongs to the user's faculty is in scope.
        course = await self.repo.get_course(course_id, realm_key=current_user["realm"]) if course_id is not None else None
        if course is not None and course.department_id is not None:
            dept = await self.repo.get_department(course.department_id, realm_key=current_user["realm"])
            if dept is not None and dept.faculty_id == faculty_id:
                return
        # Otherwise the course must be enrolled to a department in the user's faculty (cross-listed).
        enrollments = await self.repo.list_enrollments(realm_key=current_user["realm"], faculty_id=faculty_id, course_id=course_id)
        if not enrollments:
            raise HTTPException(status_code=403, detail="You can only request changes for courses in your faculty")

    async def create_change_request(self, data: ChangeRequestCreate, current_user: dict) -> dict:
        role = current_user.get("role")
        if role not in self._CHANGE_REQUEST_ROLES:
            raise HTTPException(status_code=403, detail="Your role cannot submit change requests")

        current_sem = await self.cal_repo.get_current_semester(realm_key=current_user["realm"])
        if not current_sem:
            raise HTTPException(status_code=400, detail="No active semester found.")
        if data.semester_id is not None and data.semester_id != current_sem.id:
            raise HTTPException(status_code=403, detail="You can only request changes for the current semester.")
        sem_id = data.semester_id or current_sem.id

        lock = await self.repo.get_lock(sem_id, data.timetable_type, realm_key=current_user["realm"])
        if lock and lock.is_locked:
            raise HTTPException(status_code=423, detail=f"This {data.timetable_type} timetable is locked.")

        course = await self.repo.get_course(data.course_id, realm_key=current_user["realm"])
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")

        target = None
        if data.action in (ChangeRequestAction.MODIFY.value, ChangeRequestAction.REMOVE.value):
            target = await self.repo.get_schedule_item(data.target_schedule_item_id, realm_key=current_user["realm"])
            if not target:
                raise HTTPException(status_code=404, detail="The schedule item to change no longer exists")
            if target.semester_id != sem_id or target.type != data.timetable_type:
                raise HTTPException(status_code=400, detail="Target schedule item does not match this timetable")

        # A request can only name the realm's own faculty and rooms.
        if data.faculty_id is not None:
            await self._faculty_in_realm(data.faculty_id, current_user)
        if data.room_ids:
            found = await self.repo.get_rooms_by_ids(data.room_ids, realm_key=current_user["realm"])
            if len(found) < len(set(data.room_ids)):
                raise HTTPException(status_code=400, detail="Room not found")

        if data.action != ChangeRequestAction.REMOVE.value:
            # A MODIFY leaves out what it doesn't change, so the target fills the gaps.
            _assert_fits_window(
                current_user,
                data.timetable_type,
                data.day_of_week if data.day_of_week is not None or target is None else target.day_of_week,
                data.exam_date if data.exam_date is not None or target is None else target.exam_date,
                data.start_time,
                data.end_time,
            )

        await self._assert_request_scope(data.action, data.course_id, target, current_user)

        sub = current_user.get("sub")
        requester_id = int(sub) if sub is not None else None

        cr = ChangeRequest(
            semester_id=sem_id,
            realm_key=current_user["realm"],
            timetable_type=data.timetable_type,
            action=data.action,
            # An ADD has no target; whatever id it sent was never checked against the realm.
            target_schedule_item_id=target.id if target else None,
            course_id=data.course_id,
            room_ids=data.room_ids,
            faculty_id=data.faculty_id,
            day_of_week=data.day_of_week,
            start_time=data.start_time,
            end_time=data.end_time,
            week=data.week,
            exam_date=data.exam_date,
            is_online=data.is_online,
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
            title, link = _for_super_admins(current_user, title, "/requests")
            await self.notification_service.notify(
                user_ids=admin_ids,
                title=title,
                message=message,
                link=link,
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
            realm_key=current_user["realm"],
            semester_id=semester_id,
            timetable_type=timetable_type,
            status=status,
            requested_by=requested_by,
        )
        return [await self._enrich_change_request(cr) for cr in rows]

    async def review_change_request(self, id: int, approve: bool, note: str | None, current_user: dict) -> dict:
        cr = await self.repo.get_change_request(id, realm_key=current_user["realm"])
        if not cr:
            raise HTTPException(status_code=404, detail="Change request not found")
        if cr.status != ChangeRequestStatus.PENDING.value:
            raise HTTPException(status_code=409, detail=f"This request has already been {cr.status.lower()}")

        if approve:
            lock = await self.repo.get_lock(cr.semester_id, cr.timetable_type, realm_key=current_user["realm"])
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
                    # NULL on requests made before online sessions existed, or sent without the flag.
                    is_online=bool(cr.is_online),
                )
                created_item = await self.create_schedule_item(payload, current_user)
                cr.resulting_schedule_item_id = created_item.id
            elif cr.action == ChangeRequestAction.MODIFY.value:
                if cr.target_schedule_item_id is None or not await self.repo.get_schedule_item(cr.target_schedule_item_id, realm_key=current_user["realm"]):
                    raise HTTPException(status_code=409, detail="The target schedule item no longer exists; cannot apply this change.")
                payload = ScheduleItemUpdate(
                    room_ids=cr.room_ids,
                    day_of_week=cr.day_of_week,
                    exam_date=cr.exam_date,
                    start_time=cr.start_time,
                    end_time=cr.end_time,
                    is_online=cr.is_online,
                )
                updated_item = await self.update_schedule_item(cr.target_schedule_item_id, payload, current_user)
                cr.resulting_schedule_item_id = updated_item.id
            elif cr.action == ChangeRequestAction.REMOVE.value:
                if cr.target_schedule_item_id is None or not await self.repo.get_schedule_item(cr.target_schedule_item_id, realm_key=current_user["realm"]):
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

        course = await self.repo.get_course(cr.course_id, realm_key=current_user["realm"]) if cr.course_id is not None else None
        course_label = course.code if course else "the course"
        if cr.requested_by is not None:
            outcome = "approved and applied" if approve else "rejected"
            title = f"Your change request was {('approved' if approve else 'rejected')}"
            link = f"/timetable/{'lectures' if cr.timetable_type == 'lecture' else 'exams'}"
            # A cross-realm requester (a super viewer) may be in another realm when this arrives.
            requester = await self.auth_repo.get_user_by_id(cr.requested_by)
            if requester and requester.role in CROSS_REALM_ROLES:
                title, link = _for_super_admins(current_user, title, link)
            await self.notification_service.notify(
                user_ids=[cr.requested_by],
                title=title,
                message=(
                    f"Your request to {cr.action.lower()} a {cr.timetable_type} session for {course_label} "
                    f"was {outcome}.\n" + (f"Note: {note.strip()}" if note else "")
                ),
                link=link,
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
            return await self.repo.list_enrollments(realm_key=current_user["realm"], course_id=course_id)
        faculty_id = current_user.get("faculty_id")
        if not faculty_id:
            return []
        return await self.repo.list_enrollments(realm_key=current_user["realm"], faculty_id=faculty_id, course_id=course_id)

    async def _check_dept_belongs_to_user_faculty(self, department_id: int, current_user: dict) -> Department:
        dept = await self.repo.get_department(department_id, realm_key=current_user["realm"])
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

        course = await self.repo.get_course(course_id, realm_key=current_user["realm"])
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        if course.scope == CourseScope.DEPARTMENTAL:
            raise HTTPException(status_code=400, detail="Departmental courses are auto-audienced; no enrollment needed")

        # Idempotent: return existing if already enrolled at this dept × level.
        existing = await self.repo.get_enrollment(course_id, department_id, level, realm_key=current_user["realm"])
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
        enrollment = await self.repo.get_enrollment(course_id, department_id, level, realm_key=current_user["realm"])
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
        return await self.repo.get_dismissals(realm_key=current_user["realm"])

    async def create_dismissal(self, data: ConflictDismissalCreate, current_user: dict) -> ConflictDismissal:
        ctype, a_id, b_id = _normalize_signature(data.conflict_type, data.item_a_id, data.item_b_id)
        if b_id is not None and b_id == a_id:
            raise HTTPException(status_code=400, detail="A conflict must reference two different schedule items")
        ids = [a_id] + ([b_id] if b_id is not None else [])
        items = await self.repo.get_schedule_items_by_ids(ids, realm_key=current_user["realm"])
        found = {i.id for i in items}
        for i in ids:
            if i not in found:
                raise HTTPException(status_code=404, detail=f"Schedule item {i} not found")
        self._assert_faculty_can_dismiss(current_user, items)

        existing = await self.repo.find_dismissal(ctype, a_id, b_id, realm_key=current_user["realm"])
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
        dept = await self.repo.get_department(data.department_id, realm_key=current_user["realm"])
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
        items = await self.repo.get_schedule_items_by_ids(list(all_ids), realm_key=current_user["realm"])
        items_map = {i.id: i for i in items}
        existing = {(d.conflict_type, d.item_a_id, d.item_b_id) for d in await self.repo.get_dismissals(realm_key=current_user["realm"])}

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
        dismissal = await self.repo.get_dismissal(id, realm_key=current_user["realm"])
        if not dismissal:
            raise HTTPException(status_code=404, detail="Dismissal not found")
        ids = [dismissal.item_a_id] + ([dismissal.item_b_id] if dismissal.item_b_id is not None else [])
        items = await self.repo.get_schedule_items_by_ids(ids, realm_key=current_user["realm"])
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
