# Dashboard

**Where:** the home page after signing in (`/`). **Who:** everyone signed in.

The dashboard shows how far the current semester's timetables have got, and introduces the menu and top bar, which are on every page.

<a id="dash-term"></a>
## Current semester

The badge at the top right names the current session and semester, for example "2026/2027 - First Semester". Everything works on this semester unless you choose another on a timetable page.
<!-- roles: SUPER_ADMIN -->
You change it on [Academic Sessions](terms.md).
<!-- /roles -->

<a id="dash-progress"></a>
## Scheduling progress

The percentage of courses that already have a slot, for lectures and exams separately. Each row shows how many are scheduled, how many are still waiting, and the total. Courses with no semester set aren't counted; the note under the panel says how many there are, so you can set one on [Courses](courses.md).

<a id="dash-capacity"></a>
## Room capacity

How many seats there are and how many are usable: active (good) and inactive (bad) seats, from each room's details on [Rooms](rooms.md).

<a id="dash-capacity-faculty"></a>
### Pick a faculty

Show room capacity for one faculty, or "All Faculties". "All Rooms →" opens the Rooms page.

<a id="dash-overview"></a>
## Overview

Progress for each faculty, with bars showing how many of its courses are scheduled. Switch between **Exams** and **Lectures** with the buttons at the top. "Manage →" opens Faculties & Departments.

<a id="dash-rooms"></a>
## Rooms by faculty

How many rooms each faculty has.

---

# The menu and top bar (every page)

<a id="sidebar"></a>
## Menu

Every section of UniSchedule, down the left. You only see the sections your role can use (see [Roles](roles.md)):

- **Dashboard**
- **Faculties & Departments**, **Courses**, **Rooms**
- **Timetables:** Lecture Timetable and Exam Timetable
<!-- roles: CITS_ADMIN -->
- **CBT Timetable:** the computer-based exams
<!-- /roles -->
<!-- roles: SUPER_ADMIN -->
- **Management:** Academic Sessions, Staff, Change Requests, Activity Logs, Signatures & Stamps
<!-- /roles -->
<!-- roles: SUPER_VIEWER -->
- **Management:** Change Requests and Activity Logs
<!-- /roles -->
<!-- roles: FACULTY_EDITOR -->
- **Staff:** invitations and editor access for your faculty
<!-- /roles -->
- **Help:** the [Help centre](help-centre.md), for everyone

The page you're on is highlighted.

<a id="sidebar-toggle"></a>
## Show or hide the menu

The button with three lines, at the top left. On a computer it collapses the menu to icons, giving the timetable more room. On a phone it opens and closes the menu; tap outside it or press Esc to close.

<a id="page-title"></a>
## Page title

The name of the page you're on, with a short description.

<a id="realm-switcher" data-roles="SUPER_ADMIN, SUPER_VIEWER, CITS_ADMIN"></a>
## Switch programme

Only for roles that work across programmes (Super Admin, Super Viewer, Super Administrator (CITS)). Shows the programme you're working in, for example "Undergraduate", and lets you switch to another, such as ICE. Each programme has its own calendar, courses, rooms and timetables. See [Programmes](glossary.md#programme).

<a id="role-switcher" data-roles="SUPER_ADMIN"></a>
## View as another role

Super Admin only. "View as…" shows UniSchedule exactly as another role sees it, to check what they can and can't do. Pick a role (and a faculty, for faculty roles). A banner shows across the top while it's on; switch back from the same menu or the banner. Anything you do meanwhile is recorded as you acting as that role. See [Viewing as another role](glossary.md#impersonation).

<a id="notifications"></a>
## Notifications

The bell. Updates that need your attention: change requests and their decisions, requests to unlock a timetable, a higher-priority course overriding yours, invitations and so on. The badge shows how many are unread. Click one to go to the page it's about.

<a id="profile-menu"></a>
## Your account

Your initial. Shows your email, role and programme.

<a id="logout"></a>
## Sign out

The door icon at the far right. Asks you to confirm, then signs you out on this device.

<a id="banners"></a>
## Banners

<!-- roles: SUPER_ADMIN -->
- **Viewing as another role:** shows while you are viewing as someone else, with a button to stop.
<!-- /roles -->
- **Past session:** shows when you're looking at a session or semester that isn't the current one. It's read-only.
