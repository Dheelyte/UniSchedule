"""Importing a faculty's lecture or exam timetable from a workbook.

`preview` and `apply` run the same steps on the uploaded file and the admin's
answers so far, so nothing is kept between requests:

1. read the workbook (reader.py) and pick a sheet;
2. match each code to a course and each venue to rooms (matcher.py), turning
   anything unmatched into a question;
3. date exam days (dates.py);
4. build schedule items and check them against the realm's rules, blocked
   slots, other realms' halls and what is already scheduled.

`apply` then replaces the faculty's timetable of that type for the current
semester, or adds to it, in one transaction.
"""
from __future__ import annotations

import collections
from datetime import date, datetime, time, timedelta, timezone
from typing import BinaryIO

from fastapi import Depends, HTTPException
from sqlalchemy import delete, func, or_, select, true, update

from modules.audit.service import AuditService
from modules.auth.repository import AuthRepository
from modules.calendar.repository import CalendarRepository
from modules.timetable.models import CourseScope, ScheduleItem
from modules.timetable.repository import TimetableRepository
from modules.timetable.service import _assert_fits_window, _times_overlap, blocked_slot_clash
from modules.timetable_import.dates import DayHeader, date_exam_days
from modules.timetable_import.models import TimetableImport
from modules.timetable_import.matcher import (
    CourseIndex, CourseRef, FacultyIndex, FacultyRef, RoomIndex, RoomRef, faculty_key,
)
from modules.timetable_import.reader import RawEntry, SheetResult, WorkbookTooLarge, read_workbook
from modules.timetable_import.schemas import ImportOptions


class TimetableImportService:
    def __init__(
        self,
        repo: TimetableRepository = Depends(),
        cal_repo: CalendarRepository = Depends(),
        audit_service: AuditService = Depends(),
        auth_repo: AuthRepository = Depends(),
    ):
        self.repo = repo
        self.cal_repo = cal_repo
        self.audit_service = audit_service
        self.auth_repo = auth_repo

    # --- Entry points ---------------------------------------------------------

    async def preview(self, file: BinaryIO, options: ImportOptions, current_user: dict) -> dict:
        plan = await self._plan(file, options, current_user)
        return plan["preview"]

    async def apply(self, file: BinaryIO, options: ImportOptions, current_user: dict) -> dict:
        return await self._apply_plan(await self._plan(file, options, current_user), options, current_user)

    async def copy_preview(self, options: ImportOptions, current_user: dict) -> dict:
        plan = await self._plan_copy(options, current_user)
        return plan["preview"]

    async def copy_apply(self, options: ImportOptions, current_user: dict) -> dict:
        return await self._apply_plan(await self._plan_copy(options, current_user), options, current_user)

    async def copy_sources(self, current_user: dict) -> dict:
        """Earlier semesters to copy from, newest first, and the one to suggest:
        the same semester of the most recent earlier session."""
        realm_key = current_user["realm"]
        current = await self.cal_repo.get_current_semester(realm_key=realm_key)
        sessions = {s.id: s for s in await self.cal_repo.get_sessions(realm_key=realm_key)}
        semesters = []
        for session_id in sorted(sessions, reverse=True):
            semesters += await self.cal_repo.get_semesters(session_id, realm_key=realm_key)
        counts = dict(((sem, kind), n) for sem, kind, n in (await self.repo.db.execute(
            select(ScheduleItem.semester_id, ScheduleItem.type, func.count())
            .where(ScheduleItem.realm_key == realm_key)
            .group_by(ScheduleItem.semester_id, ScheduleItem.type)
        )).all())
        rows = [
            {
                "id": sem.id,
                "name": sem.name,
                "session_name": sessions[sem.session_id].name,
                "lectures": counts.get((sem.id, "lecture"), 0),
                "exams": counts.get((sem.id, "exam"), 0),
            }
            for sem in semesters if not current or sem.id != current.id
        ]
        same_name = [r for r in rows if current and r["name"] == current.name and (r["lectures"] or r["exams"])]
        return {
            "current": {"id": current.id, "name": current.name, "session_name": sessions[current.session_id].name} if current else None,
            "semesters": rows,
            "suggested_id": same_name[0]["id"] if same_name else None,
        }

    async def _apply_plan(self, plan: dict, options: ImportOptions, current_user: dict) -> dict:
        preview = plan["preview"]
        if not preview["ready"]:
            raise HTTPException(status_code=400, detail="Answer the remaining questions before importing")
        blocking = [i for i in preview["items"] if i["blocking"]]
        if blocking and not options.skip_blocked:
            raise HTTPException(
                status_code=400,
                detail=f"{len(blocking)} session(s) can't be scheduled as they are. Fix them or choose to leave them out.",
            )

        realm_key = current_user["realm"]
        replaced = plan["replaced"]
        if replaced:
            await self.repo.db.execute(delete(ScheduleItem).where(ScheduleItem.id.in_([s.id for s in replaced])))
        created = []
        for item in preview["items"]:
            if item["blocking"]:
                continue
            for faculty_id in item["faculty_ids"]:
                created.append(await self.repo.create_schedule_item(ScheduleItem(
                    course_id=item["course_id"],
                    room_ids=item["room_ids"],
                    faculty_id=faculty_id,
                    is_online=item.get("is_online", False),
                    day_of_week=item["day_of_week"],
                    start_time=item["start_time"],
                    end_time=item["end_time"],
                    type=options.item_type,
                    week=item["week"],
                    exam_date=item["exam_date"],
                    semester_id=plan["semester"].id,
                    realm_key=realm_key,
                )))

        record = TimetableImport(
            realm_key=realm_key,
            faculty_id=options.faculty_id,
            semester_id=plan["semester"].id,
            item_type=options.item_type,
            mode=options.mode,
            place_in_faculties=options.place_in_faculties,
            source_semester_id=options.source_semester_id,
            file_name=preview["file_name"],
            sheet=preview["sheet"],
            created_ids=[c.id for c in created],
            replaced=[_snapshot(s) for s in replaced],
            left_out=len(blocking),
            created_by=_user_id(current_user),
            created_by_email=await self._email(current_user),
        )
        self.repo.db.add(record)
        await self.repo.db.flush()

        await self.audit_service.log(
            current_user=current_user,
            action=f"schedule_item.{options.item_type}.import",
            entity_type="timetable_import",
            entity_id=record.id,
            description=(
                f"{'Copied' if options.source_semester_id else 'Imported'} {len(created)} {options.item_type}(s) for "
                f"{plan['faculty'].name if plan['faculty'] else 'all faculties'}"
                + (" and the faculties it names" if options.place_in_faculties else "") + " from "
                f"{preview['file_name']} ({options.mode}"
                + (f", {len(replaced)} removed" if replaced else "") + ")"
            ),
            extra={"faculty_id": options.faculty_id, "semester_id": plan["semester"].id, "left_out": len(blocking)},
        )
        return {"import_id": record.id, "created": len(created), "removed": len(replaced), "left_out": len(blocking)}

    async def list_imports(self, current_user: dict, item_type: str | None = None, limit: int = 50) -> list[dict]:
        realm_key = current_user["realm"]
        query = select(TimetableImport).where(TimetableImport.realm_key == realm_key)
        if item_type:
            query = query.where(TimetableImport.item_type == item_type)
        records = list((await self.repo.db.execute(
            query.order_by(TimetableImport.id.desc()).limit(limit)
        )).scalars().all())

        current = await self.cal_repo.get_current_semester(realm_key=realm_key)
        faculty_names = {f.id: f.name for f in await self.repo.get_faculties(realm_key=realm_key)}
        all_ids = {i for r in records for i in (r.created_ids or [])}
        present = set()
        if all_ids:
            present = set((await self.repo.db.execute(
                select(ScheduleItem.id).where(ScheduleItem.id.in_(all_ids), ScheduleItem.realm_key == realm_key)
            )).scalars().all())
        return [
            {
                "id": r.id,
                "faculty_id": r.faculty_id,
                "faculty_name": faculty_names.get(r.faculty_id, r.faculty_id) if r.faculty_id else "All faculties",
                "copied": r.source_semester_id is not None,
                "item_type": r.item_type,
                "mode": r.mode,
                "place_in_faculties": r.place_in_faculties,
                "file_name": r.file_name,
                "sheet": r.sheet,
                "created_count": len(r.created_ids or []),
                # Sessions it added that are still in the timetable; edits and later imports remove some.
                "still_present": sum(1 for i in (r.created_ids or []) if i in present),
                "replaced_count": len(r.replaced or []),
                "left_out": r.left_out,
                "created_by_email": r.created_by_email,
                "created_at": r.created_at.isoformat(),
                "reverted_at": r.reverted_at.isoformat() if r.reverted_at else None,
                "reverted_by_email": r.reverted_by_email,
                "restored_count": len(r.restored_ids or []),
                "current_semester": bool(current and r.semester_id == current.id),
                "can_revert": r.reverted_at is None and bool(current and r.semester_id == current.id),
                "would_restore": bool(r.replaced) and r.reverted_at is None and not await self._replaced_later(r),
            }
            for r in records
        ]

    async def revert(self, import_id: int, current_user: dict) -> dict:
        """Remove the sessions an import added. If it replaced a timetable, put
        that back too - unless a later import has since replaced it again, when
        the old sessions would land on top of the newer ones."""
        realm_key = current_user["realm"]
        record = (await self.repo.db.execute(
            select(TimetableImport)
            .where(TimetableImport.id == import_id, TimetableImport.realm_key == realm_key)
            # Two revert clicks at once must not both put the old timetable back.
            .with_for_update()
        )).scalar_one_or_none()
        if not record:
            raise HTTPException(status_code=404, detail="Import not found")
        if record.reverted_at:
            raise HTTPException(status_code=409, detail="This import has already been reverted")
        current = await self.cal_repo.get_current_semester(realm_key=realm_key)
        if not current or record.semester_id != current.id:
            raise HTTPException(status_code=400, detail="Only imports into the current semester can be reverted")
        lock = await self.repo.get_lock(record.semester_id, record.item_type, realm_key=realm_key)
        if lock and lock.is_locked:
            raise HTTPException(status_code=423, detail=f"This {record.item_type} timetable is locked.")

        removed = 0
        if record.created_ids:
            removed = (await self.repo.db.execute(
                delete(ScheduleItem).where(ScheduleItem.id.in_(record.created_ids), ScheduleItem.realm_key == realm_key)
            )).rowcount

        restored = []
        if record.replaced and not await self._replaced_later(record):
            for old in record.replaced:
                item = await self.repo.create_schedule_item(ScheduleItem(
                    course_id=old["course_id"],
                    room_ids=old["room_ids"] or [],
                    faculty_id=old.get("faculty_id", record.faculty_id),
                    day_of_week=old["day_of_week"],
                    exam_date=date.fromisoformat(old["exam_date"]) if old["exam_date"] else None,
                    week=old["week"],
                    start_time=time.fromisoformat(old["start_time"]),
                    end_time=time.fromisoformat(old["end_time"]),
                    type=record.item_type,
                    semester_id=record.semester_id,
                    realm_key=realm_key,
                    is_online=old.get("is_online", False),
                ))
                restored.append(item)
                # An earlier import that added this session should still find it.
                if old.get("id"):
                    await self.repo.db.execute(
                        update(TimetableImport)
                        .where(TimetableImport.realm_key == realm_key, TimetableImport.created_ids.any(old["id"]))
                        .values(created_ids=func.array_replace(TimetableImport.created_ids, old["id"], item.id))
                    )

        record.reverted_at = datetime.now(timezone.utc)
        record.reverted_by = _user_id(current_user)
        record.reverted_by_email = await self._email(current_user)
        record.restored_ids = [r.id for r in restored]
        await self.repo.db.flush()

        await self.audit_service.log(
            current_user=current_user,
            action=f"schedule_item.{record.item_type}.import_revert",
            entity_type="timetable_import",
            entity_id=record.id,
            description=(
                f"Reverted the import of {record.file_name or 'a file'}: {removed} {record.item_type}(s) removed"
                + (f", {len(restored)} put back" if restored else "")
            ),
            extra={"faculty_id": record.faculty_id, "removed": removed, "restored_ids": record.restored_ids},
        )
        return {"removed": removed, "restored": len(restored)}

    async def _replaced_later(self, record: TimetableImport) -> bool:
        """Whether a later import, still in place, replaced the same timetable again."""
        # A replace of all faculties replaces each of them, and any replace touches an all-faculty one.
        same_faculty = (
            true() if record.faculty_id is None
            else or_(TimetableImport.faculty_id == record.faculty_id, TimetableImport.faculty_id.is_(None))
        )
        return (await self.repo.db.execute(
            select(TimetableImport.id).where(
                TimetableImport.realm_key == record.realm_key,
                same_faculty,
                TimetableImport.semester_id == record.semester_id,
                TimetableImport.item_type == record.item_type,
                TimetableImport.mode == "replace",
                TimetableImport.reverted_at.is_(None),
                TimetableImport.id > record.id,
            ).limit(1)
        )).first() is not None

    async def _email(self, current_user: dict) -> str | None:
        if current_user.get("email"):
            return current_user["email"]
        user_id = _user_id(current_user)
        user = await self.auth_repo.get_user_by_id(user_id) if user_id else None
        return user.email if user else None

    # --- The plan ---------------------------------------------------------------

    async def _plan(self, file: BinaryIO, options: ImportOptions, current_user: dict) -> dict:
        realm_key = current_user["realm"]
        if options.faculty_id is None:
            raise HTTPException(status_code=400, detail="Choose the faculty this file is for")
        faculty = await self.repo.get_faculty(options.faculty_id, realm_key=realm_key)
        if not faculty:
            raise HTTPException(status_code=404, detail="Faculty not found")
        semester = await self.cal_repo.get_current_semester(realm_key=realm_key)
        if not semester:
            raise HTTPException(status_code=400, detail="No active semester found. Please create a current semester before importing.")
        lock = await self.repo.get_lock(semester.id, options.item_type, realm_key=realm_key)
        if lock and lock.is_locked:
            raise HTTPException(status_code=423, detail=f"This {options.item_type} timetable is locked.")

        try:
            sheets = read_workbook(file)
        except WorkbookTooLarge:
            raise HTTPException(status_code=413, detail="This workbook is too large to import. Remove unused sheets and rows and try again.")
        except Exception:
            raise HTTPException(status_code=400, detail="That file couldn't be read. Upload an Excel (.xlsx) or Word (.docx) file.")
        sheet = _choose_sheet(sheets, options.sheet)

        courses = await self.repo.get_courses(realm_key=realm_key)
        rooms = await self.repo.get_rooms(realm_key=realm_key)
        course_index = CourseIndex([CourseRef(c.id, c.code, c.title) for c in courses])
        room_index = RoomIndex(
            [RoomRef(r.id, r.name, r.capacity or 0, r.faculty_id, r.is_active) for r in rooms], faculty.id,
        )
        general_ids = {c.id for c in courses if c.scope == CourseScope.UNIVERSITY_WIDE}
        answers = options.answers
        # Answers name ids; like any id from the client, one outside this realm is not found.
        for course_id in answers.courses.values():
            if course_id is not None and course_id not in course_index.by_id:
                raise HTTPException(status_code=404, detail="Course not found")
        for room_ids in answers.venues.values():
            if any(r not in room_index.by_id for r in room_ids):
                raise HTTPException(status_code=404, detail="Room not found")
        faculties = await self.repo.get_faculties(realm_key=realm_key)
        faculty_index = FacultyIndex([FacultyRef(f.id, f.name) for f in faculties])
        faculty_name = {f.id: f.name for f in faculties}
        if any(fid is not None and fid not in faculty_name for fid in answers.faculties.values()):
            raise HTTPException(status_code=404, detail="Faculty not found")
        entries = [e for e in sheet.entries if e.codes] if sheet else []

        # Courses
        course_questions: dict[str, dict] = {}
        course_of: dict[str, int | None] = {}
        for e in entries:
            for code in e.codes:
                if code in course_of or code in course_questions:
                    continue
                if code in answers.courses:
                    course_of[code] = answers.courses[code]
                elif (match := course_index.match(code)):
                    course_of[code] = match.id
                else:
                    course_questions[code] = {
                        "code": code,
                        "examples": [],
                        "suggestions": [_course_out(c) for c in course_index.suggest(code)],
                    }
        for e in entries:
            for code in e.codes:
                if code in course_questions and len(course_questions[code]["examples"]) < 3:
                    course_questions[code]["examples"].append(_where(e))

        # Venues: the venue column that names the most rooms, or the bracket in the cell.
        venue_col = answers.venue_column
        if venue_col is None:
            width = max((len(e.venues) for e in entries), default=0)
            hits = [sum(1 for e in entries if len(e.venues) > i and room_index.match(e.venues[i])) for i in range(width)]
            venue_col = hits.index(max(hits)) if hits and max(hits) else 0
        venue_questions: dict[str, dict] = {}
        rooms_of_text: dict[str, list[int]] = {}
        venue_matches: dict[str, list[int]] = {}  # matched without asking; shown so they can be changed

        def venue_rooms(e: RawEntry) -> tuple[str | None, list[int] | None]:
            text = e.venues[venue_col] if len(e.venues) > venue_col else None
            if not text:
                # A room written in the cell itself: "CMS 102 (MCB 5)".
                for note in e.notes:
                    if (found := room_index.match(note)):
                        return note, [r.id for r in found]
                return None, []
            if text in answers.venues:
                return text, answers.venues[text]
            if text not in rooms_of_text:
                found = room_index.match(text)
                if found is not None:
                    venue_matches[text] = [r.id for r in found]
                if found is None:
                    same_name = room_index.same_name(text)
                    venue_questions.setdefault(text, {
                        "text": text, "count": 0,
                        # Several rooms are called this; say which faculty each belongs to.
                        "same_name": bool(same_name),
                        "suggestions": [
                            {**_room_out(r), "faculty": faculty_name.get(r.faculty_id) if r.faculty_id else None}
                            for r in (same_name or room_index.suggest(text))
                        ],
                    })
                    venue_questions[text]["count"] += 1
                    return text, None
                rooms_of_text[text] = [r.id for r in found]
            return text, rooms_of_text[text]

        # Exam dates
        dating = None
        if options.item_type == "exam" and entries:
            headers = {e.day_seq: DayHeader(e.day_seq, e.weekday, e.date, e.year_missing, e.date_text) for e in entries}
            dating = date_exam_days(list(headers.values()), start_date=answers.exam_start_date, year=answers.exam_year)

        # Which faculties each row goes to. General Studies' lectures go to every
        # faculty; its exams go to the faculties each row names, a group a day.
        by_row = options.place_in_faculties and options.item_type == "exam"
        faculty_questions: dict[str, dict] = {}
        faculty_notes: collections.Counter = collections.Counter()

        def row_faculties(e: RawEntry) -> list[str]:
            if not options.place_in_faculties:
                return [faculty.id]
            if not by_row:
                return [faculty.id] + [f.id for f in faculties if f.id != faculty.id]
            ids = [faculty.id]
            for name in e.faculties:
                if name in answers.faculties:
                    found = answers.faculties[name]
                elif not faculty_key(name):
                    faculty_notes[name] += 1  # "(Physically Challenged Student)"
                    continue
                elif (match := faculty_index.match(name)):
                    found = match.id
                else:
                    faculty_questions.setdefault(name, {
                        "text": name, "count": 0,
                        "suggestions": [{"id": f.id, "name": f.name} for f in faculty_index.suggest(name)],
                    })["count"] += 1
                    continue
                if found and found not in ids:
                    ids.append(found)
            return ids

        # What's there now
        existing = await self.repo.get_schedule_items(realm_key=realm_key, semester_id=semester.id)
        existing = [s for s in existing if s.type == options.item_type]
        shared_ids = _shared_course_ids(existing, len(faculties))
        shared_skipped: collections.Counter = collections.Counter()

        # Items, one per course and time, with the rooms of every row it sits in.
        merged: dict[tuple, dict] = {}
        for e in entries:
            venue_text, room_ids = venue_rooms(e)
            row_targets = row_faculties(e)
            exam_date = None
            if dating is not None:
                exam_date = dating.dates.get(e.day_seq)
                if exam_date is None:
                    continue
            for code in e.codes:
                course_id = course_of.get(code)
                if course_id is None:
                    continue
                if course_id in shared_ids and not options.place_in_faculties:
                    # Placed in every faculty by General Studies; a faculty's file doesn't move it.
                    shared_skipped[course_index.by_id[course_id].code] += 1
                    continue
                day = None if exam_date else e.weekday
                key = (course_id, day, exam_date, e.start, e.end)
                if by_row:
                    # Each venue on a day is its own sitting, with its own faculties.
                    key += (tuple(sorted(room_ids or [])) or venue_text,)
                item = merged.setdefault(key, {
                    "course_id": course_id,
                    "code": course_index.by_id[course_id].code,
                    "title": course_index.by_id[course_id].title,
                    "day_of_week": day,
                    "exam_date": exam_date,
                    "week": e.week,
                    "start_time": e.start,
                    "end_time": e.end,
                    "room_ids": [],
                    "venues": [],
                    "sources": [],
                    "cells": [],
                    "awaiting_venue": False,
                    "general": course_id in general_ids,
                    "faculty_ids": [],
                    "is_online": False,
                })
                for fid in row_targets:
                    if fid not in item["faculty_ids"]:
                        item["faculty_ids"].append(fid)
                if room_ids is None:
                    item["awaiting_venue"] = True
                for rid in room_ids or []:
                    if rid not in item["room_ids"]:
                        item["room_ids"].append(rid)
                if venue_text and venue_text not in item["venues"]:
                    item["venues"].append(venue_text)
                item["sources"].append(_where(e))
                item["cells"].append(f"{e.sheet}!{e.row}:{e.first_col}")
        items = sorted(merged.values(), key=lambda i: (
            i["exam_date"] or date.min, _weekday_order(i["day_of_week"]), i["start_time"], i["code"],
        ))
        if dating is not None:
            _number_exam_weeks(items)
        for item in items:
            item["faculty_count"] = len(item["faculty_ids"])
            if by_row:
                item["faculties"] = [faculty_name[f] for f in item["faculty_ids"][1:]]
        placed = {f for i in items for f in i["faculty_ids"]}

        if options.place_in_faculties:
            # This timetable is every faculty's copy of the courses in the file and of
            # those already placed from here.
            courses_here = {i["course_id"] for i in items} | {s.course_id for s in existing if s.faculty_id == faculty.id}
            own = [s for s in existing if s.course_id in courses_here]
        else:
            # A faculty's timetable, less the courses General Studies places in every faculty.
            own = [s for s in existing if s.faculty_id == faculty.id and s.course_id not in shared_ids]
        replaced = own if options.mode == "replace" else []
        staying = [s for s in existing if s not in replaced]

        await self._check(items, staying, room_index, course_index, semester, faculty, options, current_user)
        if by_row:
            _check_faculty_groups(items, [f.id for f in faculties if f.id != faculty.id], faculty_name)

        skipped = collections.Counter(
            e.leftover or e.text for e in (sheet.entries if sheet else []) if not e.codes
        )
        questions = {
            "courses": list(course_questions.values()),
            "venues": list(venue_questions.values()),
            "faculties": list(faculty_questions.values()),
            "exam_start_date": bool(dating and dating.needs_start_date),
            "exam_year": bool(dating and dating.needs_year),
        }
        open_questions = (
            len(questions["courses"]) + len(questions["venues"]) + len(questions["faculties"])
            + questions["exam_start_date"] + questions["exam_year"]
        )
        imported_codes = {i["code"] for i in items}
        current_codes = {course_index.by_id[s.course_id].code for s in own if s.course_id in course_index.by_id}

        preview = {
            "file_name": getattr(file, "name", None) or options.file_name,
            "sheets": [
                {"name": s.name, "shape": s.shape, "entries": len(s.entries), "courses": s.course_count}
                for s in sheets
            ],
            "sheet": sheet.name if sheet else None,
            "warnings": (sheet.warnings if sheet else []) + (dating.problems if dating else []),
            "venue_column": venue_col,
            "venue_matches": [
                {"text": t, "rooms": [_room_out(room_index.by_id[r]) for r in ids]} for t, ids in venue_matches.items()
            ],
            "venue_columns": _venue_column_samples(entries),
            "questions": questions,
            "open_questions": open_questions,
            "ready": open_questions == 0 and bool(items),
            "items": items,
            "blocking_count": sum(1 for i in items if i["blocking"]),
            "warning_count": sum(1 for i in items if i["warnings"]),
            "skipped_text": [{"text": t, "count": n} for t, n in skipped.most_common()],
            "shared_courses": [{"code": c, "count": n} for c, n in shared_skipped.most_common()],
            "faculty_count": len(placed),
            # Faculties none of the file's sessions go to, and lines that only note something.
            "unplaced_faculties": sorted(n for f, n in faculty_name.items() if f not in placed) if by_row else [],
            "faculty_notes": list(faculty_notes),
            "diff": {
                "mode": options.mode,
                "current_count": len(own),
                "new_count": len(items),
                "added_courses": sorted(imported_codes - current_codes),
                # In replace mode these courses lose every session they have now.
                "missing_courses": sorted(current_codes - imported_codes),
            },
        }
        return {"preview": preview, "replaced": replaced, "semester": semester, "faculty": faculty}

    async def _plan_copy(self, options: ImportOptions, current_user: dict) -> dict:
        """Schedule the current semester from an earlier one: the same courses, days,
        times and rooms. Exams keep their weekdays, moved to start in the week of
        the first exam date the admin gives."""
        realm_key = current_user["realm"]
        if options.source_semester_id is None:
            raise HTTPException(status_code=400, detail="Choose the semester to copy from")
        semester = await self.cal_repo.get_current_semester(realm_key=realm_key)
        if not semester:
            raise HTTPException(status_code=400, detail="No active semester found. Please create a current semester before copying.")
        source = await self.cal_repo.get_semester(options.source_semester_id, realm_key=realm_key)
        if not source:
            raise HTTPException(status_code=404, detail="Semester not found")
        if source.id == semester.id:
            raise HTTPException(status_code=400, detail="That is the semester being scheduled; choose an earlier one")
        faculty = None
        if options.faculty_id is not None:
            faculty = await self.repo.get_faculty(options.faculty_id, realm_key=realm_key)
            if not faculty:
                raise HTTPException(status_code=404, detail="Faculty not found")
        lock = await self.repo.get_lock(semester.id, options.item_type, realm_key=realm_key)
        if lock and lock.is_locked:
            raise HTTPException(status_code=423, detail=f"This {options.item_type} timetable is locked.")
        sessions = {s.id: s for s in await self.cal_repo.get_sessions(realm_key=realm_key)}
        source_name = f"{sessions[source.session_id].name} {source.name}" if source.session_id in sessions else source.name

        courses = await self.repo.get_courses(realm_key=realm_key)
        rooms = await self.repo.get_rooms(realm_key=realm_key)
        course_index = CourseIndex([CourseRef(c.id, c.code, c.title) for c in courses])
        room_index = RoomIndex(
            [RoomRef(r.id, r.name, r.capacity or 0, r.faculty_id, r.is_active) for r in rooms], faculty.id if faculty else None,
        )
        general_ids = {c.id for c in courses if c.scope == CourseScope.UNIVERSITY_WIDE}
        faculties = await self.repo.get_faculties(realm_key=realm_key)
        faculty_name = {f.id: f.name for f in faculties}
        answers = options.answers

        old = [s for s in await self.repo.get_schedule_items(realm_key=realm_key, semester_id=source.id)
               if s.type == options.item_type]
        # One faculty's copy leaves out General Studies' courses, as an import does;
        # copying all faculties brings every faculty's copy of them along.
        source_shared = _shared_course_ids(old, len(faculties)) if faculty else set()
        shared_skipped: collections.Counter = collections.Counter()
        if faculty:
            old = [s for s in old if s.faculty_id == faculty.id]

        # Exams move by whole weeks so each keeps its weekday.
        shift = None
        needs_start_date = False
        if options.item_type == "exam" and old:
            first = min(s.exam_date for s in old if s.exam_date)
            if answers.exam_start_date is None:
                needs_start_date = True
            else:
                start = answers.exam_start_date
                shift = (start - timedelta(days=start.weekday())) - (first - timedelta(days=first.weekday()))

        gone_courses: collections.Counter = collections.Counter()
        gone_rooms = 0
        merged: dict[tuple, dict] = {}
        for s in old if not needs_start_date else []:
            course = course_index.by_id.get(s.course_id)
            if not course:
                gone_courses[s.course_id] += 1
                continue
            if s.course_id in source_shared:
                shared_skipped[course.code] += 1
                continue
            room_ids = [r for r in (s.room_ids or []) if r in room_index.by_id]
            gone_rooms += len(s.room_ids or []) - len(room_ids)
            exam_date = s.exam_date + shift if (s.exam_date and shift is not None) else None
            day = None if options.item_type == "exam" else s.day_of_week
            key = (s.course_id, day, exam_date, s.start_time, s.end_time, tuple(sorted(room_ids)), s.is_online)
            item = merged.setdefault(key, {
                "course_id": s.course_id,
                "code": course.code,
                "title": course.title,
                "day_of_week": day,
                "exam_date": exam_date,
                "week": None,
                "start_time": s.start_time,
                "end_time": s.end_time,
                "room_ids": room_ids,
                "venues": [],
                "sources": [],
                "cells": [f"copy:{len(merged)}"],
                "awaiting_venue": False,
                "general": s.course_id in general_ids,
                "faculty_ids": [],
                "is_online": s.is_online,
                "rooms_dropped": len(s.room_ids or []) != len(room_ids),
            })
            if s.faculty_id not in item["faculty_ids"]:
                item["faculty_ids"].append(s.faculty_id)
        items = sorted(merged.values(), key=lambda i: (
            i["exam_date"] or date.min, _weekday_order(i["day_of_week"]), i["start_time"], i["code"],
        ))
        if options.item_type == "exam":
            _number_exam_weeks(items)
        for item in items:
            item["faculty_count"] = len(item["faculty_ids"])
            if not faculty:
                item["faculties"] = [faculty_name.get(f, f) if f else "No faculty (General Studies)" for f in item["faculty_ids"]]

        existing = [s for s in await self.repo.get_schedule_items(realm_key=realm_key, semester_id=semester.id)
                    if s.type == options.item_type]
        if faculty:
            shared_now = _shared_course_ids(existing, len(faculties))
            own = [s for s in existing if s.faculty_id == faculty.id and s.course_id not in shared_now]
        else:
            own = existing
        replaced = own if options.mode == "replace" else []
        staying = [s for s in existing if s not in replaced]

        await self._check(items, staying, room_index, course_index, semester, faculty, options, current_user)
        for item in items:
            if item.pop("rooms_dropped"):
                item["warnings"].append("A room it used before no longer exists")
            if item["is_online"]:
                item["warnings"] = [w for w in item["warnings"] if w != "No venue"]

        imported_codes = {i["code"] for i in items}
        current_codes = {course_index.by_id[s.course_id].code for s in own if s.course_id in course_index.by_id}
        warnings = []
        if gone_courses:
            warnings.append(f"{sum(gone_courses.values())} session(s) are for courses that no longer exist and are left out")
        if gone_rooms:
            warnings.append(f"{gone_rooms} room(s) used in {source_name} no longer exist")
        if not old:
            warnings.append(f"{source_name} has no {options.item_type}s{' for this faculty' if faculty else ''} to copy")
        open_questions = int(needs_start_date)
        preview = {
            "file_name": source_name,
            "source": {"id": source.id, "name": source_name},
            "sheets": [],
            "sheet": None,
            "warnings": warnings,
            "venue_column": 0,
            "venue_matches": [],
            "venue_columns": [],
            "questions": {
                "courses": [], "venues": [], "faculties": [],
                "exam_start_date": needs_start_date, "exam_year": False,
            },
            "open_questions": open_questions,
            "ready": open_questions == 0 and bool(items),
            "items": items,
            "blocking_count": sum(1 for i in items if i["blocking"]),
            "warning_count": sum(1 for i in items if i["warnings"]),
            "skipped_text": [],
            "shared_courses": [{"code": c, "count": n} for c, n in shared_skipped.most_common()],
            "faculty_count": len({f for i in items for f in i["faculty_ids"]}),
            "unplaced_faculties": [],
            "faculty_notes": [],
            "diff": {
                "mode": options.mode,
                "current_count": len(own),
                "new_count": sum(i["faculty_count"] for i in items),
                "added_courses": sorted(imported_codes - current_codes),
                "missing_courses": sorted(current_codes - imported_codes),
            },
        }
        return {"preview": preview, "replaced": replaced, "semester": semester, "faculty": faculty}

    # --- Checks -----------------------------------------------------------------

    async def _check(self, items, staying, room_index, course_index, semester, faculty, options, current_user) -> None:
        """Sets `blocking` (can't be saved as it is) and `warnings` (can, but look) on each item."""
        realm_key = current_user["realm"]
        item_type = options.item_type
        blocked_slots = await self.repo.get_blocked_slots(realm_key=realm_key, semester_id=semester.id)
        others = []
        if not (faculty and faculty.is_special):
            others = [
                o for o in await self.repo.get_other_realms_current_items(realm_key=realm_key, item_type=item_type)
                if not o["is_special_faculty"]
            ]
        faculty_names = {f.id: f.name for f in await self.repo.get_faculties(realm_key=realm_key)}

        copying = options.source_semester_id is not None
        here = "in what is being copied" if copying else "in this file"

        def together(a, b) -> bool:
            """Codes written in the same cell are one class taught together: `PPL 311/301`."""
            return bool(set(a["cells"]) & set(b["cells"]))

        def same_slot(a_day, a_date, b_day, b_date) -> bool:
            return (a_date == b_date) if item_type == "exam" else (a_day == b_day)

        for i, item in enumerate(items):
            problems, warnings = [], []
            try:
                _assert_fits_window(current_user, item_type, item["day_of_week"], item["exam_date"],
                                    item["start_time"], item["end_time"])
            except HTTPException as exc:
                problems.append(exc.detail)
            for slot in blocked_slots:
                if (clash := blocked_slot_clash(slot, item_type, item["day_of_week"], item["exam_date"],
                                                item["start_time"], item["end_time"])):
                    problems.append(clash)
            for o in others:
                shared = set(item["room_ids"]) & set(o["room_ids"])
                if shared and same_slot(item["day_of_week"], item["exam_date"], o["day_of_week"], o["exam_date"]) \
                        and _times_overlap(item["start_time"], item["end_time"], o["start_time"], o["end_time"]):
                    names = ", ".join(room_index.by_id[r].name for r in shared if r in room_index.by_id)
                    problems.append(f"{names} is booked by {o['realm_name']} for {o['course_code']} at that time")
            inactive = [room_index.by_id[r].name for r in item["room_ids"] if room_index.by_id.get(r) and room_index.by_id[r].is_active is False]
            if inactive:
                problems.append(f"Inactive room: {', '.join(inactive)}")

            for r in item["room_ids"]:
                room = room_index.by_id.get(r)
                if room and room.capacity <= 0:
                    warnings.append(f"{room.name} has no capacity set; it may be an old copy of another room")
                # General Studies always sits its papers in other faculties' halls.
                if room and faculty and room.faculty_id and room.faculty_id != faculty.id and not options.place_in_faculties:
                    warnings.append(f"{room.name} belongs to {faculty_names.get(room.faculty_id, room.faculty_id)}")
            if item["general"]:
                warnings.append("University-wide course: check General Studies hasn't scheduled it too")
            if item["awaiting_venue"]:
                warnings.append("Venue not matched yet")
            elif not item["room_ids"]:
                warnings.append("No venue")
            # Several exams can share a hall; lectures can't.
            if item_type == "lecture":
                for s in staying:
                    if s.day_of_week == item["day_of_week"] and set(s.room_ids or []) & set(item["room_ids"]) \
                            and _times_overlap(item["start_time"], item["end_time"], s.start_time, s.end_time):
                        other = course_index.by_id.get(s.course_id)
                        warnings.append(
                            f"Room clash with {other.code if other else 'another course'}"
                            f" ({faculty_names.get(s.faculty_id, 'General Studies')})"
                        )
                for j, other in enumerate(items):
                    if j != i and not together(item, other) and other["day_of_week"] == item["day_of_week"] \
                            and set(other["room_ids"]) & set(item["room_ids"]) \
                            and _times_overlap(item["start_time"], item["end_time"], other["start_time"], other["end_time"]):
                        warnings.append(f"Room clash with {other['code']} {here}")
            # General Studies sits one paper in several venues at once, each for its own
            # faculties; a copy brings those sittings along as they were.
            for j, other in enumerate(items):
                if j != i and other["course_id"] == item["course_id"] and not options.place_in_faculties and not copying \
                        and same_slot(item["day_of_week"], item["exam_date"], other["day_of_week"], other["exam_date"]) \
                        and _times_overlap(item["start_time"], item["end_time"], other["start_time"], other["end_time"]):
                    warnings.append(f"{item['code']} is in this file twice at overlapping times")
            item["problems"] = problems
            item["warnings"] = list(dict.fromkeys(warnings))
            item["blocking"] = bool(problems)


# --- Helpers --------------------------------------------------------------------

def _choose_sheet(sheets: list[SheetResult], name: str | None) -> SheetResult | None:
    if name is not None:
        for s in sheets:
            if s.name == name:
                return s
        raise HTTPException(status_code=400, detail=f"No sheet named '{name}' in this file")
    readable = [s for s in sheets if s.entries]
    return max(readable, key=lambda s: s.course_count) if readable else None


def _check_faculty_groups(items: list[dict], faculty_ids: list[str], faculty_name: dict[str, str]) -> None:
    """General Studies' exams sit a group of faculties a day, since no venue holds them all.
    Warn when one paper puts every faculty on one day, or one faculty on two sittings."""
    by_course: dict[int, list[dict]] = collections.defaultdict(list)
    for item in items:
        by_course[item["course_id"]].append(item)
    for sittings in by_course.values():
        days: dict = collections.defaultdict(set)
        seen: dict[str, list[dict]] = collections.defaultdict(list)
        for item in sittings:
            for f in item["faculty_ids"][1:]:
                days[item["exam_date"]].add(f)
                seen[f].append(item)
        for day, on_day in days.items():
            if faculty_ids and on_day >= set(faculty_ids):
                for item in sittings:
                    if item["exam_date"] == day:
                        item["warnings"].append(f"Every faculty sits {item['code']} on the same day")
        for f, its in seen.items():
            if len(its) > 1:
                when = ", ".join(sorted({f"{i['exam_date']:%a %d %b} {i['start_time']:%H:%M}" for i in its}))
                for item in its:
                    item["warnings"].append(f"{faculty_name.get(f, f)} sits {item['code']} more than once ({when})")
    for item in items:
        item["warnings"] = list(dict.fromkeys(item["warnings"]))


def _shared_course_ids(existing: list[ScheduleItem], faculty_count: int) -> set[int]:
    """Courses scheduled under at least half the faculties: General Studies' courses,
    which it places in every faculty's timetable."""
    faculties_of: dict[int, set[str]] = collections.defaultdict(set)
    for s in existing:
        if s.faculty_id:
            faculties_of[s.course_id].add(s.faculty_id)
    threshold = max(3, -(-faculty_count // 2))
    return {course_id for course_id, ids in faculties_of.items() if len(ids) >= threshold}


def _number_exam_weeks(items: list[dict]) -> None:
    """Week 1 is the week of the first exam, unless the sheet numbered its weeks."""
    dated = [i["exam_date"] for i in items if i["exam_date"]]
    if not dated:
        return
    first_monday = min(dated) - timedelta(days=min(dated).weekday())
    for i in items:
        if i["exam_date"] and i["week"] is None:
            i["week"] = (i["exam_date"] - first_monday).days // 7 + 1


def _venue_column_samples(entries: list[RawEntry]) -> list[list[str]]:
    """A few texts from each venue column, so the admin can pick the right one."""
    width = max((len(e.venues) for e in entries), default=0)
    return [list(dict.fromkeys(e.venues[i] for e in entries if len(e.venues) > i))[:4] for i in range(width)]


_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _weekday_order(day: str | None) -> int:
    return _WEEKDAYS.index(day) if day in _WEEKDAYS else -1


def _where(e: RawEntry) -> dict:
    return {"sheet": e.sheet, "row": e.row, "text": e.text}


def _course_out(c: CourseRef) -> dict:
    return {"id": c.id, "code": c.code, "title": c.title}


def _room_out(r: RoomRef) -> dict:
    return {"id": r.id, "name": r.name, "capacity": r.capacity}


def _user_id(current_user: dict) -> int | None:
    try:
        return int(current_user.get("sub"))
    except (TypeError, ValueError):
        return None


def _snapshot(s: ScheduleItem) -> dict:
    return {
        "id": s.id,
        "faculty_id": s.faculty_id,
        "course_id": s.course_id,
        "room_ids": s.room_ids,
        "day_of_week": s.day_of_week,
        "exam_date": s.exam_date.isoformat() if s.exam_date else None,
        "week": s.week,
        "start_time": s.start_time.isoformat(),
        "end_time": s.end_time.isoformat(),
        "is_online": s.is_online,
    }
