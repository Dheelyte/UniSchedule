# UniSchedule user guide

UniSchedule is the University of Lagos timetable system. Timetable officers and staff use it to build the lecture, exam and CBT timetables for each programme. Students and visitors use it to download FINAL timetables and to check printed copies.

This guide explains every page and feature. Each page of the app has its own page here, with the same name. Signed-in staff read it in the app as the [Help centre](help-centre.md), at `/help`, which shows each person only what their role can use. Students and visitors get the public questions at `/faq`.

## Start here

- [Common questions](faq.md): quick answers, linked to the right page.
- [Roles: who can do what](roles.md): the roles and what each is for.
- [Words used in UniSchedule](glossary.md): FINAL, conflicts, blocked slots, programmes, shared halls and more.
- [Page previews](page-previews.md): the step-by-step tours on every page.
- [Help centre](help-centre.md): finding your way around this guide in the app.

## Pages for staff (signed in)

| Page | What it's for |
|---|---|
| [Dashboard](dashboard.md) | Progress at a glance, and the menu and top bar |
| [Faculties & Departments](faculties.md) | The faculties and departments in a programme |
| [Courses](courses.md) | Every course, who takes it, and shared courses |
| [Rooms](rooms.md) | Rooms and halls, their seats, order and shared halls |
| [Lecture timetable](timetable-lectures.md) | The weekly lecture timetable |
| [Exam timetable](timetable-exams.md) | The exam timetable, date by date |
| [CBT timetable](timetable-cbt.md) | Computer-based exams |
| [The timetable grid](timetable-grid.md) | How the grid works on all three timetables |
| [Import a timetable](timetable-import.md) | Bring in a timetable from a file or an earlier semester |
| [Academic Sessions](terms.md) | Sessions, semesters and blocked time |
| [Staff](staff.md) | Invitations, roles, editor access handovers |
| [Change Requests](requests.md) | Reviewing requests to change a course's slot |
| [Activity Logs](activity.md) | The record of actions, and the analysis report |
| [Signatures & Stamps](signoffs.md) | What FINAL timetable PDFs are signed with |

## Pages for everyone

| Page | What it's for |
|---|---|
| [Home page](landing.md) | The public front page |
| [Signing in](signing-in.md) | Choosing a programme, signing in, invitations and password reset |
| [Download a timetable](download.md) | FINAL timetables for anyone, no account needed |
| [Check a printed copy](verify.md) | Verifying a timetable or activity report by its code |
| [Contributors](contributors.md) | The people behind UniSchedule |

## Keeping this guide up to date

Every feature that is added, changed or removed must be reflected here in the same change, along with its page preview in `src/lib/tours.js`. See the rule in `AGENTS.md`.

Each feature's section starts with an anchor named after its `data-tour` name in the app (for example `#tt-export`). Keep these the same: page previews' "Learn more" links and shared links rely on them.

The backend serves this folder to the Help centre (`/help`), filtered for the reader's role (`backend/modules/help/guide.py`). Each file is a page (`courses.md` is `/help/courses`); the groups above, with the text after each link, become the Help centre's menu and home page. A new file appears there once it's linked from this page. This section isn't shown in the app.

### Who sees what

Mark anything that isn't for every signed-in role. Use the role names (`SUPER_ADMIN`, `SUPER_VIEWER`, `FACULTY_EDITOR`, `FACULTY_VIEWER`, `HOD`, `DEO`, `GS_ADMIN`, `CITS_ADMIN`), separated by commas:

- **A whole page:** `<!-- page-roles: SUPER_ADMIN, SUPER_VIEWER -->` as its first line.
- **A section and everything under it:** `data-roles` on its anchor, for example `<a id="tt-lock" data-roles="SUPER_ADMIN"></a>`.
- **Lines inside a section** (list items, table rows, sentences): put them between `<!-- roles: FACULTY_EDITOR -->` and `<!-- /roles -->` on their own lines.
- **The public FAQ:** questions in `faq.md` tagged `data-roles="public"` also appear at `/faq` for everyone. Their links must go to public pages (`/download`, `/verify`, `/realms`, `/forgot-password`), not to guide pages.

Hidden content never leaves the server, and links to anything a reader can't see become plain text. Keep shared sentences role-neutral: don't name a page or feature some readers can't use outside a marked section or block. `backend/tests/test_help.py` checks that no other role receives the Super Admin material.
