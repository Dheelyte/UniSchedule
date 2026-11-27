# Rooms

**Where:** Rooms in the menu (`/rooms`). **Who:** everyone can view. Super Admins and Faculty Editors (their own faculty) add and edit rooms. GS Admins manage rooms with no faculty.

The rooms and halls lectures and exams are held in, grouped by faculty.

<a id="rooms-add-from" data-roles="SUPER_ADMIN, FACULTY_EDITOR, GS_ADMIN"></a>
## Add from Undergraduate

In programmes other than Undergraduate, for example ICE. Pick halls from the Undergraduate list to use here. Each becomes a room in this programme, linked to the Undergraduate original as the same physical hall, so the two programmes can never book it at the same time. See [Shared hall](glossary.md#shared-hall).

<a id="rooms-add" data-roles="SUPER_ADMIN, FACULTY_EDITOR, GS_ADMIN"></a>
## Add a room

Called "Create new room" when Add from Undergraduate is available. The room form has:

- **Room name**, for example "LT-A (Main Lecture Theatre)".
- **Faculty** it belongs to.
- **Seating capacity:** active (good) seats and inactive (bad) seats. Capacity is the good seats.
- **Lab:** mark the room as a laboratory.
<!-- roles: SUPER_ADMIN -->
- **Status:** active or inactive. Nothing new can be booked in an inactive room.
- **Same physical hall** (when editing): link this room to a room in another programme, or unlink it.
<!-- /roles -->

<a id="rooms-stats"></a>
## At a glance

Total rooms, total capacity, average capacity, and large venues (300 seats or more).

<a id="rooms-search"></a>
## Search

Find a room by name.

<a id="rooms-sort"></a>
## Order

- **Custom Order:** the order rooms appear in on the timetable grid. Change it with the [arrows](#rooms-reorder).
- **Sort by Name** or **Sort by Capacity:** for looking things up. These don't change the grid.

<a id="rooms-faculty"></a>
## Filter by faculty

Show one faculty's rooms.

<a id="rooms-list"></a>
## Rooms by faculty

Each faculty's rooms with their status, capacity, size, and how many timetable slots are booked in them ("No bookings" if none). Rooms with no faculty are listed at the end.

<a id="rooms-faculty-group"></a>
### Open or close a faculty

Click a faculty's header to show or hide its rooms. The header shows how many venues it has and its active and inactive seats.

<a id="rooms-hall"></a>
### Shared hall

A tag under a room's name shows it's the same physical hall as a room in another programme. A booking in either blocks the other at the same time. Editing or deleting a room never changes another programme's room.

<a id="rooms-reorder" data-roles="SUPER_ADMIN, FACULTY_EDITOR, GS_ADMIN"></a>
### Move up or down

With Custom Order, the arrows move a room up or down the timetable grid.

<a id="rooms-row-actions" data-roles="SUPER_ADMIN, FACULTY_EDITOR, GS_ADMIN"></a>
## Edit or delete

The pencil edits a room. The bin deletes it after you confirm. A room with bookings can't be deleted (the bin is greyed out): move its bookings first, or mark it inactive instead.
