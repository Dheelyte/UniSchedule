# Courses

**Where:** Courses in the menu (`/courses`). **Who:** everyone can view. Super Admins, Faculty Editors (their own faculty) and GS Admins add and edit courses.

Every course in this programme: its code, title, semester, credit load, lecturers, department and faculty.

<a id="courses-add" data-roles="SUPER_ADMIN, FACULTY_EDITOR, GS_ADMIN"></a>
## Add a course

Opens the course form:

- **Course type:** Departmental, Interfaculty or University-Wide (see [course types](#courses-type)).
- **Course code** (for example `CSC201`) and **credit load**.
- **Course title.**
- **Faculty and department** that own the course, and the **level** (or all levels) and **semester** it's taken in.
- **Lecturers**, separated by commas.

The level and semester must be ones this programme uses; they come from its calendar settings.

<a id="courses-faculty" data-roles="SUPER_ADMIN"></a>
## Filter by faculty

Super Admin only. Show one faculty's courses.

<a id="courses-department"></a>
## Filter by department

Show only the courses one department takes.

<a id="courses-search"></a>
## Search

Find a course by its code, title or lecturer.

<a id="courses-type"></a>
## Course type

Filter by type. The type also decides which course wins when two clash for the same students (see [Course priority](glossary.md#priority)):

1. **University-Wide:** taken by everyone, such as GST. Highest priority. Managed by GS Admins.
2. **Interfaculty:** shared between faculties.
3. **Departmental:** belongs to one department.

<a id="courses-count"></a>
## Results

"Showing X of Y courses" with your filters applied.

<a id="courses-table"></a>
## The list

Your own faculty's courses come first. The list loads more as you scroll, so it stays fast even with thousands of courses.

<a id="courses-row-actions" data-roles="SUPER_ADMIN, FACULTY_EDITOR, GS_ADMIN, CITS_ADMIN"></a>
## Edit or delete

The pencil edits a course; the bin deletes it after you confirm. You can only edit your own faculty's courses. A Super Administrator (CITS) can only change whether a course is a CBT exam.

<a id="courses-take"></a>
## Take a shared course

For another faculty's Interfaculty or University-Wide course, Faculty Editors and Super Admins see **Take**. It adds your departments and levels to the course, so it appears in your faculty's timetable and is checked against your students' other classes. Once taken, the button shows **Manage (n)** to change or remove them, and viewers see "Taken (n)".
