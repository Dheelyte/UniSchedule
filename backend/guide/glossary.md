s# Words used in UniSchedule

<a id="programme"></a>
## Programme (realm)

A programme such as Undergraduate (UG) or ICE (part-time). Each has its own calendar (teaching days, hours, levels and semester names), faculties, departments, rooms, courses, sessions, timetables, staff and activity log. Nothing is shared between programmes except [shared halls](#shared-hall). Postgraduate and Foundation exist but aren't live yet.

<a id="session"></a>
## Session and semester

An academic session (for example 2026/2027) holds semesters. One session and one of its semesters are **current**: everyone works in them, and only the current semester's timetables can be edited. Past semesters stay visible but read-only.
<!-- roles: SUPER_ADMIN -->
You set them on [Academic Sessions](terms.md).
<!-- /roles -->

<a id="draft-final"></a>
## Draft and FINAL

A timetable is a **draft** until the timetable office **locks** it. Locking marks it **FINAL**:

- Nobody can edit it until it's unlocked.
- Its PDFs carry the signatory's signature, name and title, the stamp, and a QR code with a [verification code](#verification-code). Drafts carry a DRAFT watermark instead.
- It appears on the public [Download](download.md) page.

If it's reopened for changes, copies printed before then show as possibly out of date when checked, and a new code is issued when it's FINAL again.

<a id="verification-code"></a>
## Verification code

A code such as `UG-7K3P-92QD`, printed with a QR code on every page of a FINAL timetable. Activity log reports get one too, starting with `LOG-`. Anyone can type it, or scan the QR code, on [Check a printed copy](verify.md) to see whether the document is genuine and still current.

<a id="conflict"></a>
## Conflict (clash)

A problem in the timetable, shown in red. Hover over a red item to read exactly what it clashes with.

- **Room conflict:** two lectures in one room at the same time. Exams may share a hall with other exams from the **same faculty**, but not with another faculty's exams.
- **Audience clash:** two different courses at the same time for the same students (the same department and level).
- **Course conflict:** the same course scheduled twice at overlapping times.
- **Duplicate exam:** a course given more than one exam.
- **Shared hall:** a booking in a [shared hall](#shared-hall) that another programme holds at that time. If another programme has a weekly lecture there and you schedule an exam, you get a warning to check those lectures have ended.
- **Outside operating hours:** a warning for a slot outside the programme's day (for UG, 08:00 to 18:00).

Bookings on [blocked time](#blocked-slot) are refused when you try to save them.

<a id="priority"></a>
### Course priority

When courses clash for the same students, the higher-priority course wins and the other is flagged:

1. **University-wide** courses (for example GST), taken by everyone;
2. **Interfaculty** courses, shared between faculties;
3. **Departmental** courses.

<a id="dismissed" data-roles="SUPER_ADMIN, FACULTY_EDITOR, GS_ADMIN, CITS_ADMIN"></a>
### Dismissed conflicts

Some clashes are intended. Anyone who can edit the timetable can dismiss them with [Manage conflicts](timetable-grid.md#grid-manage-conflicts) so they're no longer flagged, and restore them later.

<a id="special-grouping"></a>
## Special grouping

A faculty-like group (such as general studies) that's left out of conflict checks, so its shared classes don't raise clashes. Marked "Special" on [Faculties & Departments](faculties.md).

<a id="blocked-slot"></a>
## Blocked slot

Time when nothing can be scheduled, for example a public holiday, a university event or a weekly free period. Lecture blocks repeat on a weekday. Exam blocks are on a date or a weekday. A whole-day block on a date works as a **holiday**. Shown striped red on the grid.
<!-- roles: SUPER_ADMIN -->
You manage them on [Academic Sessions](terms.md#terms-add-blocked).
<!-- /roles -->

<a id="shared-hall"></a>
## Shared hall (hall group)

The same physical hall listed in two programmes, for example a UG hall that ICE also uses. The rooms are linked, so a booking in one blocks the other at the same time. Rooms that aren't linked never clash across programmes. See [Rooms](rooms.md#rooms-hall).

<a id="cbt"></a>
## CBT

Computer-based test: an exam taken on computers. CBT courses are scheduled on their own [CBT timetable](timetable-cbt.md).

<a id="impersonation" data-roles="SUPER_ADMIN"></a>
## Viewing as another role (impersonation)

A Super Admin can see UniSchedule exactly as another role does, to check what that person can and can't do. A banner shows while it's on. Anything done meanwhile is recorded in the activity log as done by the Super Admin acting as that role.
