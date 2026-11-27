# Faculties & Departments

**Where:** Faculties & Departments in the menu (`/faculties`). **Who:** everyone can view. Super Admins add, edit and delete faculties. Super Admins and Faculty Editors add departments.

The faculties in this programme and the departments under each. Courses, rooms and staff belong to them.

<a id="fac-add-faculty" data-roles="SUPER_ADMIN"></a>
## Add a faculty

Super Admin only. Enter the faculty's name (for example "Faculty of Science"). In Undergraduate you also give it a short ID, such as `SCI`, which can't be changed later. In other programmes the ID is created for you (for example `ICE-…`). Names must be unique within a programme.

<a id="fac-add-dept" data-roles="SUPER_ADMIN, FACULTY_EDITOR"></a>
## Add a department

Enter the department's name and choose its faculty. The "Add Department" button inside an open faculty fills in that faculty for you.

<a id="fac-stats" data-roles="SUPER_ADMIN"></a>
## At a glance

Super Admin only. How many faculties, special groupings and departments the programme has.

<a id="fac-table"></a>
## The list

Each faculty with its number of departments. Click a faculty's row to open it and see its departments.

<a id="fac-expand"></a>
### Open a faculty

The arrow at the start of a row shows or hides that faculty's departments.

<a id="fac-special"></a>
### Special grouping

A faculty marked **Special** (such as general studies) is left out of conflict checks, so its shared classes don't raise clashes. See [Special grouping](glossary.md#special-grouping).

<a id="fac-row-actions" data-roles="SUPER_ADMIN, FACULTY_EDITOR"></a>
## Edit or delete

The pencil renames a faculty or department; the bin deletes it after you confirm. Super Admins manage faculties; departments can be managed from inside an open faculty.
