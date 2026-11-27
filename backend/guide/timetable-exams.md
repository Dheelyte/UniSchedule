# Exam timetable

**Where:** Exam Timetable in the menu (`/timetable/exams`). **Who:** as for the [lecture timetable](timetable-lectures.md).

The exam timetable for a semester, date by date. It works like the lecture timetable, with dates instead of weekdays. The grid is explained in [The timetable grid](timetable-grid.md).

These work exactly as on the lecture timetable:

- [Draft or FINAL](timetable-lectures.md#tt-status)
<!-- roles: SUPER_ADMIN -->
- [Lock or unlock](timetable-lectures.md#tt-lock)
- [Import](timetable-lectures.md#tt-import) and [Copy semester](timetable-lectures.md#tt-copy)
<!-- /roles -->
<!-- roles: FACULTY_EDITOR -->
- [Ask to edit](timetable-lectures.md#tt-request-edit)
<!-- /roles -->
- [Choose a semester](timetable-lectures.md#tt-semester)
<!-- roles: FACULTY_EDITOR, FACULTY_VIEWER, HOD, GS_ADMIN, SUPER_VIEWER -->
- [Request a change](timetable-lectures.md#tt-request-change)
<!-- /roles -->
- [Export](timetable-lectures.md#tt-export). The exam export has no day-by-day layout.

<a id="tt-shift" data-roles="SUPER_ADMIN"></a>
## Shift exams (Beta)

Super Admin, current semester, draft only, in programmes that use it. Moves many exams at once, for example when exams are postponed. Choose how:

- **By exam days:** move each exam a number of exam days later or earlier.
- **By weeks:** move exams a number of weeks later or earlier. You can tick **Only shift some exams** to limit it to certain faculties or a range of dates.
- **To a new start date:** give the new date for the first exam, and the rest move with it.

Sundays, holidays and blocked slots are skipped, and times and venues stay the same. You see a preview before anything changes, and the whole shift is saved at once or not at all.

## Exams sharing a hall

Several exams can be in one hall at the same time if they're from the **same faculty**. Exams from different faculties in one hall are a conflict. See [Conflict](glossary.md#conflict).
