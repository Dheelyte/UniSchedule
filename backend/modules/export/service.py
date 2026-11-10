"""Timetable export data.

The PDFs and CSVs are drawn by the frontend's renderer (src/lib/pdfExport.js and
friends): in the browser for signed-in staff, and on the frontend server for
public downloads. This module only gathers the data, in one request, so neither
has to load the whole app state first.
"""
from fastapi import Depends, HTTPException

from modules.auth.models import RoleEnum
from modules.calendar.repository import CalendarRepository
from modules.export.repository import ExportRepository
from modules.export.schemas import (
    BundleRealm,
    DownloadOptions,
    ExportBundle,
    OptionDepartment,
    OptionFaculty,
    PublicExportBundle,
    PublishedTimetable,
)
from modules.realms.repository import RealmRepository
from modules.signoff.service import SignoffService
from modules.timetable.service import TimetableService


def _public_reader(realm_key: str) -> dict:
    """A read-only, realm-wide view used for public downloads (never written with)."""
    return {"realm": realm_key, "role": RoleEnum.SUPER_VIEWER.value, "sub": None, "faculty_id": None}


class ExportService:
    def __init__(
        self,
        timetable: TimetableService = Depends(),
        signoff: SignoffService = Depends(),
        cal_repo: CalendarRepository = Depends(),
        realm_repo: RealmRepository = Depends(),
        repo: ExportRepository = Depends(),
    ):
        self.timetable = timetable
        self.signoff = signoff
        self.cal_repo = cal_repo
        self.realm_repo = realm_repo
        self.repo = repo

    async def bundle(self, current_user: dict, semester_id: int, timetable_type: str) -> ExportBundle:
        """What the caller would see on the timetable page, for one semester and type.

        Uses the same reads as the page, so a role sees exactly what it can see today.
        A semester of another realm is not found.
        """
        realm_key = current_user["realm"]
        semester = await self.cal_repo.get_semester(semester_id, realm_key=realm_key)
        if not semester:
            raise HTTPException(status_code=404, detail="Semester not found")
        session = await self.cal_repo.get_session(semester.session_id, realm_key=realm_key)
        realm = await self.realm_repo.get_realm(realm_key)

        items = [
            item for item in await self.timetable.get_schedule_items(current_user, semester_id=semester_id)
            if item.type == timetable_type
        ]
        course_ids = {item.course_id for item in items}
        courses = [c for c in await self.timetable.get_courses(current_user) if c.id in course_ids]
        enrollments = [e for e in await self.timetable.list_enrollments(current_user) if e.course_id in course_ids]

        signoff = await self.signoff.export_signoff(semester_id, timetable_type, current_user)
        return ExportBundle(
            realm=BundleRealm(key=realm.key, name=realm.name, config=realm.config),
            session_name=session.name if session else "",
            semester_id=semester.id,
            semester_name=semester.name,
            timetable_type=timetable_type,
            is_locked=signoff.is_locked,
            signoff=signoff,
            schedule_items=items,
            courses=courses,
            enrollments=enrollments,
            faculties=await self.timetable.get_faculties(current_user, all=True),
            departments=await self.timetable.get_departments(current_user, all=True),
            rooms=await self.timetable.get_rooms(current_user, all=True),
            blocked_slots=await self.timetable.get_blocked_slots(current_user, semester_id=semester_id),
        )

    async def _final_bundle(self, realm_key: str, semester_id: int, timetable_type: str) -> ExportBundle:
        """The full bundle of a FINAL timetable in a live realm. Drafts are not found."""
        realm = await self.realm_repo.get_realm(realm_key)
        if not realm or not realm.is_live:
            raise HTTPException(status_code=404, detail="No published timetable")
        lock = await self.timetable.repo.get_lock(semester_id, timetable_type, realm_key=realm_key)
        if not lock or not lock.is_locked:
            raise HTTPException(status_code=404, detail="No published timetable")
        return await self.bundle(_public_reader(realm_key), semester_id, timetable_type)

    async def public_bundle(self, realm_key: str, semester_id: int, timetable_type: str) -> PublicExportBundle:
        """A FINAL timetable as anyone may download it.

        Trimmed to what a printed timetable shows. Never includes the signature
        or stamp images: public copies carry the signatory's name, the QR code
        and the verification code instead, so the images can't be lifted from a
        public download and reused.
        """
        bundle = await self._final_bundle(realm_key, semester_id, timetable_type)
        return PublicExportBundle.model_validate(bundle.model_dump())

    async def published(self) -> list[PublishedTimetable]:
        return [PublishedTimetable(**row) for row in await self.repo.published_timetables()]

    async def options(self, realm_key: str, semester_id: int, kind: str) -> DownloadOptions:
        """The faculties, departments and levels a published timetable has something for.

        Counts a course for the department that owns it and for every department
        enrolled in it, as the export filter does.
        """
        timetable_type = "exam" if kind == "cbt" else kind
        bundle = await self._final_bundle(realm_key, semester_id, timetable_type)
        courses = {c.id: c for c in bundle.courses}
        if kind == "cbt":
            courses = {cid: c for cid, c in courses.items() if c.is_cbt_exam}
        items = [item for item in bundle.schedule_items if item.course_id in courses]
        used = {item.course_id for item in items}

        dept_faculty = {d.id: d.faculty_id for d in bundle.departments}
        faculty_ids = {item.faculty_id for item in items if item.faculty_id}
        dept_ids: set[int] = set()
        levels: set[int] = set()
        for course_id in used:
            course = courses[course_id]
            if course.department_id:
                dept_ids.add(course.department_id)
            if course.level:
                levels.add(course.level)
        for enrollment in bundle.enrollments:
            if enrollment.course_id in used:
                dept_ids.add(enrollment.department_id)
                levels.add(enrollment.level)
        faculty_ids |= {dept_faculty[d] for d in dept_ids if d in dept_faculty}

        every = sorted(
            (OptionFaculty(id=f.id, name=f.name, is_special=bool(f.is_special)) for f in bundle.faculties),
            key=lambda f: f.name.lower(),
        )
        return DownloadOptions(
            faculties=[f for f in every if f.id in faculty_ids],
            all_faculties=every,
            departments=sorted(
                (OptionDepartment(id=d.id, name=d.name, faculty_id=d.faculty_id) for d in bundle.departments if d.id in dept_ids),
                key=lambda d: d.name.lower(),
            ),
            levels=sorted(levels),
        )
