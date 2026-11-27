# Lecture timetable

**Where:** Lecture Timetable in the menu (`/timetable/lectures`). **Who:** everyone can view. Super Admins, Faculty Editors (their own faculty) and GS Admins (university-wide courses) edit it while it's a draft and the semester is current.

The weekly lecture timetable for a semester: which course is in which room, on which day and at what time. The grid itself is explained in [The timetable grid](timetable-grid.md).

<a id="tt-status"></a>
## Draft or FINAL

The badge at the top left shows whether the timetable is still a **draft** or locked as **FINAL**. See [Draft and FINAL](glossary.md#draft-final).

<a id="tt-lock" data-roles="SUPER_ADMIN"></a>
## Lock or unlock

Super Admin only, on the current semester.

- **Lock** marks the timetable FINAL. Nobody can edit it, its PDFs are signed and stamped, it gets a [verification code](glossary.md#verification-code), and it appears on the public Download page.
- **Unlock** reopens it. Copies printed before then show as possibly out of date when checked, and locking again issues a new code.

<a id="tt-request-edit" data-roles="FACULTY_EDITOR"></a>
## Ask to edit

Faculty Editors, when the timetable is locked. Asks the Super Admins to unlock it, with an optional reason. They're notified straight away.

<a id="tt-semester"></a>
## Choose a semester

View another semester's timetable. Only the current semester can be edited; others are read-only.

<a id="tt-import" data-roles="SUPER_ADMIN"></a>
## Import (Beta)

Super Admin, current semester, draft only. Opens [Import a timetable](timetable-import.md) to bring in a faculty's timetable from an Excel, Word or PDF file.

<a id="tt-copy" data-roles="SUPER_ADMIN"></a>
## Copy semester (Beta)

Super Admin, current semester, draft only. Opens [Import a timetable](timetable-import.md#imp-copy-from) to start this semester from an earlier one.

<a id="tt-request-change" data-roles="FACULTY_EDITOR, FACULTY_VIEWER, HOD, GS_ADMIN, SUPER_VIEWER"></a>
## Request a change

For roles that can't edit directly (Faculty Viewers, HODs, Super Viewers, and others while the timetable is unlocked): ask for a change to a course's slot. Choose the course and the kind of change (a different day, time or room, an exam date, or online), and give a reason. A Super Admin reviews it on [Change Requests](requests.md); approving applies the change.

<a id="tt-export"></a>
## Export

Download the timetable. Choose:

- the **session** and **semester**;
- **faculty**, **department** and **level** (or all of them);
- the **format**, PDF or CSV;
- for PDFs, the **layout**: the standard week grid, or a day-by-day layout (hourly in Undergraduate, half-hourly in ICE);
- the **paper size**, A3 or A4 landscape.

A FINAL timetable's PDF carries the signature, stamp and QR code; a draft carries a DRAFT watermark. Anyone can download FINAL timetables without signing in, from [Download a timetable](download.md).
