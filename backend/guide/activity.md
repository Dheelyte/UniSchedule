<!-- page-roles: SUPER_ADMIN, SUPER_VIEWER -->
# Activity Logs

**Where:** Activity Logs in the menu (`/activity`). **Who:** Super Admins; Super Viewers can look but not export.

A record of every important action in this programme: who did what, and when. All times are Lagos time (WAT, UTC+1).

## What's recorded

Sign-ins and programme switches; changes to courses, rooms, faculties and departments; every timetable change (created, moved, removed, imported, shifted), including what an edit replaced; locks and unlocks; blocked slots; change requests and decisions; dismissed conflicts; invitations, role changes and editor access handovers; sessions; sign-offs; exports of this log.

<!-- roles: SUPER_ADMIN -->
When a Super Admin is [viewing as another role](glossary.md#impersonation), their actions are recorded as them acting as that role.
<!-- /roles -->

<a id="act-search"></a>
## Search

Find entries whose description contains a word, such as a course code or an email.

<a id="act-timeframe"></a>
## Timeframe

Today, yesterday, this week, the last 7 days, this month, the last 30 days, the current academic session, all time, or a custom range. A custom range can also be limited to a time of day. An export can't cover "All time"; the export window turns it into the last 12 months.

<a id="act-users"></a>
## Users

Show only what certain people did. Deleted accounts are still listed by email.

<a id="act-more"></a>
## More filters

The rest of the filters, folded away. The number on the button shows how many are in use.

- **What happened:** categories (for example Lecture timetable, Editor access handovers), specific actions, and the timetable (lecture or exam).
- **Who and where:** roles, faculty, department, and portal (this programme, cross-programme actions, or both).

<a id="act-chips"></a>
## Active filters

Each filter in use, as a chip. Click a chip's x to remove it, or **Clear all**. The filters are also in the page address, so you can share or bookmark a filtered view.

<a id="act-table"></a>
## Entries

Newest first: when, who, their role, the action and a description.

<a id="act-details"></a>
### Details

Everything recorded with an entry, for example the values a timetable edit replaced, or what a deleted item held.

<a id="act-more-rows"></a>
### Load more

The next page of older entries.

<a id="act-export" data-roles="SUPER_ADMIN"></a>
## Export analysis

Super Admin only. Downloads an analysis of the activity you've filtered, as a **PDF report** (the default) or an **Excel workbook**. Every export is recorded in the log.

The export window starts from the page's filters and shows live counts. Choose:

- the sections to include;
- the format;
- whether to **mask emails** (for example `a***a@unilag.edu.ng`).

An export covers at most 12 months.

### Sections

| Section | What it shows |
|---|---|
| Summary | Total events, unique users, busiest day and hour, most common action, and a comparison with the previous period of the same length |
| By category & action | Counts and share of the total, with the previous period |
| By user | Each person's events, roles, top actions and last activity |
| By role & portal | Activity by role and programme, and programme switches |
| Over time | Events per day or week, and a day-by-hour heatmap |
| Out of hours | Activity outside the programme's working days and hours (from its calendar), or on a holiday |
| Unusual activity | Many deletions at once, bursts of changes, and schedule changes outside a person's own faculty |
| Impersonation sessions | Who viewed as which role, for how long, and what they did |
| Sensitive actions | Role changes, invitations, handovers, locks and unlocks, deletions, exports |
| Editor access handovers | Who gave their access to whom, when it ended and how |
| Locked timetables | Each time a FINAL timetable was reopened, any edit request before it, the edits made while open, and who locked it again |
| Course history | Every change to each course's slots, busiest courses first |
| Change requests | Created, approved, rejected, and the time taken to decide |
| Exports of this log | Who exported the log, when, and whether emails were masked |
| Members | Everyone with access, inactive accounts, accounts to review, and open invitations |
| Raw data | Every entry (in Excel, always included; in the PDF, the first 2,000) |

### Reports about people who can't impersonate

The report is role-based. If it only covers people who can't impersonate or export (for example, filtered to Faculty Editors), the Impersonation and Exports of this log sections are left out. Entries a Super Admin made while acting as one of those people are left out of every count too.

### The PDF report

It has:

- a cover with the university crest;
- a contents page;
- an **audit record** (reference, period, filters, who generated it and when, data snapshot);
- the sections;
- a **Review and sign-off** page with space to sign;
- a **verification code** and QR code (`LOG-…`). Anyone can check it on [Check a printed copy](verify.md). That page confirms the report's reference, period and number of events, without showing whom it covers.
