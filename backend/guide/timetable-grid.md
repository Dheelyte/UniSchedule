# The timetable grid

The grid used on the [lecture](timetable-lectures.md), [exam](timetable-exams.md) and [CBT](timetable-cbt.md) timetables.

<a id="grid-readonly"></a>
## Read-only view

A yellow note explains why you can look but not change anything: the timetable is locked as FINAL, you're viewing a semester that isn't current, or your role views only.

<a id="grid-faculty"></a>
## Filter by faculty

Show one faculty's lectures or exams, or "All Faculties".

<a id="grid-department"></a>
## Filter by department

Narrow to one department of the chosen faculty.

<a id="grid-hide-empty"></a>
## Hide empty rooms

Hide rooms with nothing booked on the day or date you're viewing, to make the grid shorter.

<a id="grid-days"></a>
## Days or dates

- **Lectures:** the teaching days, from the programme's calendar. The number on each day is how many lectures are on it.
- **Exams:** each date with exams on it, and how many. An item with no date shows as "(no date)" so it can be fixed.

<a id="grid-add-date" data-roles="SUPER_ADMIN, FACULTY_EDITOR, GS_ADMIN, CITS_ADMIN"></a>
### Add an exam date

Exam timetables. Pick a date and click "+ Add Date" to start scheduling on it. Only days the programme holds exams on can be added.

<a id="grid-count"></a>
## What you're looking at

How many lectures or exams are on the day or date you're viewing, with your filters applied.

<a id="grid-conflicts"></a>
## Conflicts

How many conflicts there are in this view. Conflicting items are red. See [Conflict](glossary.md#conflict) for the kinds there are.

<a id="grid-jump-conflict"></a>
### Go to a conflict

Jumps to the first conflict, even on another day, and highlights it.

<a id="grid-manage-conflicts" data-roles="SUPER_ADMIN, FACULTY_EDITOR, GS_ADMIN, CITS_ADMIN"></a>
### Manage conflicts

Anyone who can edit the timetable (not viewers, and not on a read-only timetable). Lists the conflicts so you can **dismiss** ones that are intended (for example two groups sharing a hall on purpose). Dismissed conflicts are no longer flagged and can be **restored** later. You can also resolve all of a department's conflicts at once. Clashes with another programme's booking can't be dismissed.

<a id="grid"></a>
## The grid

Each row is a room; each column is half an hour of the programme's day (for Undergraduate, 08:00 to 18:00). Each coloured block is a lecture or exam, showing its course code and times.

<a id="grid-rooms"></a>
### Rooms

Rooms run down the left in the order set on [Rooms](rooms.md#rooms-sort), with their capacity. Online classes have their own row.

<a id="grid-add" data-roles="SUPER_ADMIN, FACULTY_EDITOR, GS_ADMIN, CITS_ADMIN"></a>
### Schedule a lecture or exam

Click an empty slot ("+ Add") to schedule something there. In the form, choose:

- the **course**;
- the **room**, plus any extra rooms if it needs more than one, or mark it **online**;
- the **start and end time**, and for exams the **date**.

Saving checks the slot first. It's refused if it lands on blocked time, a day or time the programme doesn't allow, an inactive room, or a shared hall another programme holds at that time.

<a id="grid-event"></a>
### A scheduled item

Hover for its details.
<!-- roles: SUPER_ADMIN, FACULTY_EDITOR, GS_ADMIN, CITS_ADMIN -->
Click to edit or remove it. Drag it to another room or time to move it. You can only change your own faculty's items; others are read-only for you.
<!-- /roles -->

<a id="grid-event-conflict"></a>
### A conflict

A red item clashes with something. Hover to read every clash it has. When courses clash for the same students, the higher-priority course wins: University-Wide, then Interfaculty, then Departmental. See [Course priority](glossary.md#priority).

<a id="grid-blocked"></a>
### Blocked time

Striped red areas are blocked, with the reason shown, for example a holiday. Nothing can be scheduled there.
<!-- roles: SUPER_ADMIN -->
You set these on [Academic Sessions](terms.md#terms-add-blocked).
<!-- /roles -->

<a id="grid-external"></a>
### Booked by another programme

A grey block in a [shared hall](glossary.md#shared-hall) is another programme's booking, labelled with the programme and course. You can't change it or book over it.
