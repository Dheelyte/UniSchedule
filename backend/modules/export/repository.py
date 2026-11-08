from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from modules.calendar.models import AcademicSession, Semester
from modules.realms.models import Realm
from modules.signoff.models import TimetableVerification
from modules.timetable.models import TimetableLock


class ExportRepository:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def published_timetables(self) -> list[dict]:
        """Every locked timetable in a live realm, with the code it is printed with.

        Public and cross-realm by design, like looking a code up at /verify.
        """
        result = await self.db.execute(
            select(
                Realm.key, Realm.name, AcademicSession.name, Semester.id, Semester.name,
                Semester.is_current, TimetableLock.timetable_type,
                TimetableVerification.code, TimetableVerification.locked_at,
            )
            .join(Semester, Semester.id == TimetableLock.semester_id)
            .join(AcademicSession, AcademicSession.id == Semester.session_id)
            .join(Realm, Realm.key == AcademicSession.realm_key)
            # Timetables locked before codes existed get theirs on their first export.
            .outerjoin(
                TimetableVerification,
                (TimetableVerification.semester_id == Semester.id)
                & (TimetableVerification.timetable_type == TimetableLock.timetable_type)
                & (TimetableVerification.realm_key == Realm.key)
                & TimetableVerification.reopened_at.is_(None),
            )
            .where(TimetableLock.is_locked.is_(True), Realm.is_live.is_(True))
            .order_by(Realm.sort_order, AcademicSession.id.desc(), Semester.id.desc(), TimetableLock.timetable_type.desc(),
                      TimetableVerification.id.desc())
        )
        keys = ("realm_key", "realm_name", "session_name", "semester_id", "semester_name",
                "is_current", "timetable_type", "code", "locked_at")
        seen, rows = set(), []
        for row in result.all():
            item = dict(zip(keys, row))
            # A timetable has one code in force; keep the first if legacy data has more.
            key = (item["semester_id"], item["timetable_type"])
            if key not in seen:
                seen.add(key)
                rows.append(item)
        return rows
