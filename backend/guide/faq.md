# Common questions

<!-- Questions tagged "public" also appear on the public FAQ (/faq) for students and visitors. Their links must go to public pages (/download, /verify, /realms, /forgot-password), not to the guide. -->

<a id="faq-account" data-roles="public"></a>
## Do I need an account to get my timetable?

No. Anyone can download the FINAL lecture, exam and CBT timetables from [Download a timetable](/download), without signing in. Accounts are only for timetable officers and staff.

<a id="faq-download" data-roles="public"></a>
## How do I get my timetable?

Open [Download a timetable](/download), choose the session and semester, choose lectures, exams or CBT, and optionally your faculty, department and level. Then download the PDF.

<a id="faq-not-listed" data-roles="public"></a>
## My timetable isn't on the download page

Only FINAL timetables are published there. If your semester, or lectures or exams, aren't listed yet, the timetable office hasn't finalised them. Check back later, or ask your department.

<a id="faq-final" data-roles="public"></a>
## What does FINAL mean?

A FINAL timetable has been checked and locked by the timetable office. It's signed and stamped on every page, with a QR code, and it can't change without being reopened. Drafts aren't published.

<a id="faq-printed" data-roles="public"></a>
## How do I know a printed timetable is real and current?

Scan the QR code on any page, or type the code printed under it, on [Check a printed copy](/verify). It says whether the copy is genuine, and whether a newer version has replaced it.

<a id="faq-mistake" data-roles="public"></a>
## I think there's a mistake in my timetable

Tell your department or faculty's timetable officer, who can ask for it to be corrected. Once the timetable is updated and finalised again, download the new copy; the old one will show as out of date when checked.

<a id="faq-password" data-roles="public"></a>
## I'm staff and forgot my password

On the sign-in page, use **Forgot your password?** to get a code by email ([reset your password](/forgot-password)).

<a id="faq-staff-account" data-roles="public"></a>
## I'm staff. How do I get an account?

Accounts are by invitation only. Ask your faculty's timetable officer or the timetable office to invite you; you'll get an email with a link to set your password.

<a id="faq-red"></a>
## Why is my lecture or exam red?

It clashes with something. Hover over it to read exactly what: another booking in the same room, another class for the same students, the same course twice, or another programme's booking in a shared hall. When courses clash for the same students, the higher-priority course wins: university-wide, then interfaculty, then departmental. See [Conflict](glossary.md#conflict) and [A conflict](timetable-grid.md#grid-event-conflict).

<a id="faq-cant-edit"></a>
## Why can't I edit the timetable?

The yellow note at the top of the timetable says why. Usually it's one of these:

- **It's locked as FINAL.**
<!-- roles: FACULTY_EDITOR -->
  You can [ask to edit](timetable-lectures.md#tt-request-edit).
<!-- /roles -->
<!-- roles: SUPER_ADMIN -->
  You can [unlock it](timetable-lectures.md#tt-lock).
<!-- /roles -->
- **You're viewing a past semester.** Only the current semester can be edited; [choose it](timetable-lectures.md#tt-semester) at the top.
<!-- roles: FACULTY_VIEWER, HOD, DEO, SUPER_VIEWER -->
- **Your role views only.**
<!-- /roles -->
<!-- roles: FACULTY_VIEWER, HOD, SUPER_VIEWER -->
  You can [request a change](timetable-lectures.md#tt-request-change) instead.
<!-- /roles -->
<!-- roles: FACULTY_EDITOR, GS_ADMIN -->
- **It's another faculty's item.** You can only change your own faculty's lectures and exams.
<!-- /roles -->

<a id="faq-unlock" data-roles="FACULTY_EDITOR"></a>
## How do I get a locked timetable unlocked?

Click [Ask to edit](timetable-lectures.md#tt-request-edit) on the timetable, with a reason. The timetable office is notified. Once it's unlocked, copies already printed show as possibly out of date when checked.

<a id="faq-lock" data-roles="SUPER_ADMIN"></a>
## How do I make a timetable FINAL?

[Lock it](timetable-lectures.md#tt-lock) from the timetable page. Its PDFs are then signed and stamped with a QR code, and it appears on the public download page. Unlock it to make changes; printed copies then show as possibly out of date.

<a id="faq-cant-book" data-roles="SUPER_ADMIN, FACULTY_EDITOR, GS_ADMIN, CITS_ADMIN"></a>
## Why won't it let me save a slot?

Saving is refused when the slot:

- lands on [blocked time](glossary.md#blocked-slot) (a holiday, event or free period);
- is on a day or at a time this programme doesn't allow;
- uses an inactive room;
- uses a [shared hall](glossary.md#shared-hall) another programme holds then.

The message says which.

<a id="faq-course-missing"></a>
## A course is missing from the timetable

- **Not scheduled yet:** check [Scheduling progress](dashboard.md#dash-progress) on the dashboard.
- **Filtered out:** check the faculty and department filters at the top of the timetable.
<!-- roles: SUPER_ADMIN, FACULTY_EDITOR, GS_ADMIN -->
- **No semester set:** courses with no semester aren't counted. Edit the course on [Courses](courses.md#courses-row-actions).
<!-- /roles -->
<!-- roles: SUPER_ADMIN, FACULTY_EDITOR -->
- **Another faculty's shared course:** if your students take it, [take it](courses.md#courses-take) so it's part of your timetable and checked against your students' classes.
<!-- /roles -->

<a id="faq-room-missing"></a>
## A room is missing from the timetable

The grid can hide rooms with no bookings that day: untick [Hide empty rooms](timetable-grid.md#grid-hide-empty).
<!-- roles: SUPER_ADMIN -->
Inactive rooms can't be booked; make a room active again on [Rooms](rooms.md#rooms-add).
<!-- /roles -->

<a id="faq-holiday" data-roles="SUPER_ADMIN"></a>
## How do I stop anything being scheduled on a holiday?

Add a whole-day [blocked slot](terms.md#terms-add-blocked) on Academic Sessions.

<a id="faq-invite" data-roles="SUPER_ADMIN, FACULTY_EDITOR"></a>
## How do I give someone access?

[Invite them](staff.md#staff-invite) by email. They set their own password from the link.
<!-- roles: SUPER_ADMIN -->
To change a role later, see [Edit role](staff.md#staff-edit-role).
<!-- /roles -->

<a id="faq-away" data-roles="FACULTY_EDITOR"></a>
## I'm going on leave. Can someone cover for me?

Yes. [Hand over your editor access](staff.md#staff-grant) to a Faculty Viewer in your faculty. They become the Faculty Editor until you take it back. See [Editor access handovers](roles.md#editor-access).

<a id="faq-who-changed" data-roles="SUPER_ADMIN, SUPER_VIEWER"></a>
## Who moved our exam?

Search for the course code on [Activity Logs](activity.md). Each entry says who made the change and when, and **Details** shows what it was before.
<!-- roles: SUPER_ADMIN -->
The activity report's Course history lists every change to each course ([Export analysis](activity.md#act-export)).
<!-- /roles -->

<a id="faq-programme" data-roles="SUPER_ADMIN, SUPER_VIEWER, CITS_ADMIN"></a>
## I can't find a faculty or its courses

You may be in the wrong programme. [Switch programme](dashboard.md#realm-switcher) at the top.

<a id="faq-preview"></a>
## How do I see a page's preview again, or turn previews off?

Use the [? button](page-previews.md#tour-help) at the bottom right of any page.
