# Roles: who can do what

Everyone with an account has one role. The role decides which pages appear in the menu and which buttons appear on each page. A button you can't use isn't shown at all.

## The roles

| Role | Shown as | In short |
|---|---|---|
| `SUPER_ADMIN` | Super Admin | Runs a programme's timetables. |
| `SUPER_VIEWER` | Super Viewer | Sees everything a Super Admin sees, but can't change it. Can send change requests. |
| `FACULTY_EDITOR` | Faculty Editor | Builds their own faculty's timetables, courses and rooms. Can hand their editor access to a Faculty Viewer. |
| `FACULTY_VIEWER` | Faculty Viewer | Sees the timetables and can send change requests. Can receive a Faculty Editor's access. |
| `HOD` | Faculty Viewer (HOD) | A Head of Department. Exactly a Faculty Viewer's access; can't receive editor access. |
| `DEO` | Departmental Examination Officer | Sees the timetables for their faculty. |
| `GS_ADMIN` | GS Admin | Manages university-wide (general studies) courses and their slots across faculties. |
| `CITS_ADMIN` | Super Administrator (CITS) | Manages the CBT timetable and which courses are taken as CBT. |

## Programmes (realms)

UniSchedule holds several programmes, such as Undergraduate (UG) and ICE (part-time). Each has its own calendar, courses, rooms, timetables and staff. See [Programmes](glossary.md#programme).

- **Super Admin, Super Viewer and Super Administrator (CITS)** work across programmes. They choose one when signing in and can switch with the [programme switcher](dashboard.md#realm-switcher).
- **Every other role** belongs to one programme only.

<a id="role-table" data-roles="SUPER_ADMIN"></a>

## What each role can do

| | Super Admin | Super Viewer | Faculty Editor | Faculty Viewer / HOD | DEO | GS Admin | CITS |
|---|---|---|---|---|---|---|---|
| View timetables | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit lecture and exam timetables | ✓ | | own faculty | | | university-wide courses | |
| Edit the CBT timetable | | | | | | | ✓ |
| Lock and unlock (FINAL) | ✓ | | | | | | |
| Ask to edit a locked timetable | | | ✓ | | | | |
| Send a change request | | ✓ | ✓ | ✓ | | ✓ | |
| Review change requests | ✓ | view only | | | | | |
| Import or copy a timetable | ✓ | | | | | | |
| Add courses | ✓ | | own faculty | | | ✓ | |
| Add rooms | ✓ | | own faculty | | | unassigned rooms | |
| Add faculties | ✓ | | | | | | |
| Add departments | ✓ | | ✓ | | | | |
| Academic Sessions and blocked time | ✓ | | | | | | |
| Invite staff | ✓ | | own faculty | | | | |
| Change someone's role | ✓ | | | | | | |
| Hand over editor access | | | ✓ | | | | |
| Activity Logs | ✓ (and export) | view only | | | | | |
| Signatures & Stamps | ✓ | | | | | | |

"Own faculty" means the faculty on the person's account.

<a id="editor-access" data-roles="SUPER_ADMIN, SUPER_VIEWER, FACULTY_EDITOR, FACULTY_VIEWER"></a>
## Editor access handovers

A Faculty Editor can hand their editor access to a Faculty Viewer in their own faculty, for example while they're away. The two roles swap: the viewer becomes the Faculty Editor, and the original editor becomes a Faculty Viewer. A faculty never ends up with two editors or none.

- Only the original editor can take it back, or pass it to another Faculty Viewer.
- A Super Admin can reverse any handover from the [Staff](staff.md#staff-handovers) page.
- The change applies the next time each person uses UniSchedule.
- Every handover is recorded in the [Activity Logs](activity.md).
