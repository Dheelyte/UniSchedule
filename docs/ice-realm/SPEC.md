# ICE realm — design spec

Base commit: `e3a3c4a` (main). Line numbers below refer to that commit. If they've drifted, search by the function or constant name.

## 1. Goal

Add ICE, the part-time programme, as a second realm next to Undergraduate (UG). ICE gets everything UG has: courses, lecture/exam/CBT timetables, locks, change requests, conflict management and exports. It has its own academic calendar, courses and staff, and a different weekly shape. ICE classes and exams run on Friday, Saturday and Sunday at flexible times.

Non-negotiables:

- **UG behaviour doesn't change.** Every UG screen, rule and export keeps working exactly as today. The UG realm config reproduces today's hardcoded values.
- **No leaks between realms.** A UG user never sees ICE courses, sessions, timetables, requests or staff, and the reverse is also true.
- **Rooms are physical and shared.** A room can't host two same-type sessions from different realms at the same time.

Today the only trace of realms is the static list in `src/app/realms/page.js:7-12`, where Undergraduate is the only live entry and links to `/login`. The backend and database have no realm concept.

## 2. Decisions

| Topic | Decision |
|---|---|
| Venues | ICE uses the same rooms, halls and CBT centres as UG. Rooms stay shared, and cross-realm room clashes are checked. UG also runs on Fridays and Saturdays. |
| Staff | Super Admin, Super Viewer and CITS Admin are **cross-realm**: they pick a realm at login and can switch. Faculty Editor, Faculty Viewer and GS Admin belong to **one** realm. |
| ICE classes | A weekly pattern like UG, on Friday, Saturday and Sunday, any time 07:00–21:00 in 15-minute steps. |
| ICE exams | Dated, on dates that fall on a Friday, Saturday or Sunday, any time 07:00–21:00. |
| Org structure | Faculties and departments are shared, because ICE courses belong to the same departments. |
| Accounts | One email is one account (`users.email` is unique). A person who edits both programmes needs two emails. |

### Confirm before Phase 1

The defaults below are used if nobody changes them. Edit them here and in §4 if ICE differs.

- ICE levels: `[100, 200, 300, 400, 500, 600, 700]`.
- ICE semester names: `First Semester`, `Second Semester`.
- ICE exam slots, used only by the A3 exam PDF layout: 07–10, 10–13, 13–16, 16–19, 19–21.
- ICE day window 07:00–21:00, with 15-minute steps.

## 3. Terms

- **Realm**: a programme with its own calendar, courses, timetables and staff. Keys: `UG`, `ICE`. `PG` and `FOUNDATION` are seeded but not live.
- **Active realm**: the realm of the current request, `current_user["realm"]`.
- **Realm-scoped** data belongs to one realm. **Shared** data is used by all realms: faculties, departments and rooms.
- **Cross-realm roles**: `SUPER_ADMIN`, `SUPER_VIEWER`, `CITS_ADMIN`. These are unrelated to the existing `_has_global_scope` / `hasGlobalScope` helpers, which are about faculties, not realms.
- **Live realm**: shown as clickable on `/realms`. A non-live realm can still be reached at `/login?realm=KEY`, so ICE staff can set up before launch.

## 4. Realm config

The config is stored as JSONB in `realms.config` and validated by a `RealmConfig` Pydantic model whenever it is written or read.

| Field | Type | Rule |
|---|---|---|
| `lecture_days` | list of str | Non-empty, unique, full English weekday names, kept in Monday→Sunday order |
| `exam_days` | list of str | Same rules as `lecture_days` |
| `day_start`, `day_end` | `"HH:MM"` | On the hour; `day_start` < `day_end` |
| `slot_minutes` | int | One of 5, 10, 15, 20, 30 or 60 |
| `exam_slots` | list of `{label, start, end}` | At least one; start < end; sorted, contiguous, inside the day window and on the slot grid |
| `levels` | list of int | Non-empty, unique, ascending |
| `semester_names` | list of str | Non-empty, unique |
| `strict` | bool | `true`: the API rejects days, times or steps outside the config (§8.1). `false`: values outside are only flagged in the UI, as today |

UG reproduces today's behaviour:

```json
{
  "lecture_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  "exam_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  "day_start": "08:00",
  "day_end": "18:00",
  "slot_minutes": 30,
  "exam_slots": [
    {"label": "9am - 12pm", "start": "09:00", "end": "12:00"},
    {"label": "12pm - 3pm", "start": "12:00", "end": "15:00"},
    {"label": "3pm - 6pm", "start": "15:00", "end": "18:00"}
  ],
  "levels": [100, 200, 300, 400, 500, 600, 700],
  "semester_names": ["First Semester", "Second Semester"],
  "strict": false
}
```

ICE:

```json
{
  "lecture_days": ["Friday", "Saturday", "Sunday"],
  "exam_days": ["Friday", "Saturday", "Sunday"],
  "day_start": "07:00",
  "day_end": "21:00",
  "slot_minutes": 15,
  "exam_slots": [
    {"label": "7am - 10am", "start": "07:00", "end": "10:00"},
    {"label": "10am - 1pm", "start": "10:00", "end": "13:00"},
    {"label": "1pm - 4pm", "start": "13:00", "end": "16:00"},
    {"label": "4pm - 7pm", "start": "16:00", "end": "19:00"},
    {"label": "7pm - 9pm", "start": "19:00", "end": "21:00"}
  ],
  "levels": [100, 200, 300, 400, 500, 600, 700],
  "semester_names": ["First Semester", "Second Semester"],
  "strict": true
}
```

`PG` and `FOUNDATION` start as placeholders: a copy of the UG config with `is_live = false`.

Changing a realm's config later doesn't rewrite existing schedule items. The new rules apply the next time an item is created or edited.

## 5. Data model and migration

| Table | Change | Notes |
|---|---|---|
| `realms` (new) | `key` (PK, varchar), `name`, `description`, `is_live` (bool, default false), `sort_order` (int), `config` (JSONB), `created_at` | Seed rows: UG (live), ICE, PG, FOUNDATION (not live) |
| `academic_sessions` | `realm_key` varchar NOT NULL, FK `realms.key`, `server_default 'UG'` | Semesters inherit their realm through their session |
| `courses` | `realm_key` as above. Unique `(realm_key, code)` replaces the unique index `ix_courses_code` | Enrollments inherit through the course |
| `schedule_items` | `realm_key` as above | Stored on the item because `semester_id` is nullable on legacy rows, and cross-realm checks query it directly |
| `change_requests` | `realm_key` as above | |
| `users`, `invitations` | `realm_key` varchar **NULL**, FK, `server_default 'UG'` | NULL for cross-realm roles (set explicitly in code) |
| `activity_logs` | `realm_key` varchar NULL | Existing rows backfilled to `UG` |
| `semesters`, `blocked_slots`, `timetable_locks`, `course_enrollments`, `conflict_dismissals`, `notifications` | No new column | Realm comes from the semester (via its session), the course or the schedule item |
| `faculties`, `departments`, `rooms` | No change | Shared |

Write one hand-written revision with `down_revision = "m3h4i5j6k7l8"` (the current head). Use autogenerate only to cross-check it. The revision performs these steps in order:

1. Create `realms` and insert the four rows with the configs from §4.
2. Add the `realm_key` columns. The server default fills existing rows with `UG`.
3. Set `realm_key = NULL` on `users` whose `role`, and on `invitations` whose `target_role`, is a cross-realm role. Set `activity_logs.realm_key = 'UG'` on existing rows.
4. On `courses`, drop the unique index `ix_courses_code`, recreate `ix_courses_code` as non-unique, and add `UniqueConstraint("realm_key", "code", name="uq_courses_realm_code")`.
5. Add an index on every new `realm_key` column.
6. Normalise the "current" flags per realm. Keep at most one current session per realm (the highest id) and one current semester per realm. Then add the partial unique index `uq_academic_sessions_one_current` on `academic_sessions(realm_key) WHERE is_current`.
7. The downgrade reverses everything. Recreating the unique code index fails if two realms share a course code, so the downgrade should check for that first and raise a clear error.

**Why the server defaults matter:** `.github/workflows/deploy.yml` runs `alembic upgrade head` on production *before* the new Lambda image is live. For a few minutes, old code runs against the new schema, and its inserts must still succeed and land in UG. Keep the `'UG'` defaults until after launch; dropping them is a follow-up.

**Rollback:** the old code ignores the realm columns. Once ICE data exists, rolling back would show ICE courses inside UG. From that point, roll forward only.

## 6. Auth and realm context

### Login

`POST /auth/login` (`modules/auth/service.py:88`) gains an optional `realm` field.

- **Realm-bound user:** if `realm` is omitted, use their own realm. If `realm` is given and differs from theirs, return 403 with "This account belongs to the {Name} portal."
- **Cross-realm user:** if `realm` is omitted, use `UG`. An unknown realm returns 400.
- Logging in to a non-live realm is allowed, so setup can happen before launch.

### Token and current user

- Every token gets a `realm` claim, whether minted by login, impersonation or a realm switch.
- `get_current_user` (`api/dependencies/auth.py:12`) re-derives the realm from the database, the same way it already re-derives the role.
  - Realm-bound user: realm = `users.realm_key`, falling back to `UG` if it's NULL.
  - Cross-realm user (judged by the *real* role): realm = the token claim (default `UG`), which must exist.
- It adds `realm`, `realm_name` and `realm_config` to the dict it returns, so `/auth/me` gives the frontend everything it needs.
- `POST /auth/switch-realm {realm}` is for cross-realm real roles only. It re-mints a plain token for the new realm, which ends any impersonation, and writes the audit entry `auth.switch_realm`.
- Starting and stopping impersonation keep the token's realm.

### Accounts

- **Invitations:** invites for realm-bound roles get `realm_key` = the active realm; invites for cross-realm roles get NULL. Registration copies the value to the new user. The invitation email names the portal, and its link is `/register?token=…&realm=KEY`.
- **Listings:** `GET /auth/users` and `GET /auth/invitations` return accounts in the active realm plus cross-realm accounts. Deletes are limited to that same set.
- **Seeded super admin** (`main.py` lifespan): set `realm_key = NULL` explicitly.
- **Role list:** define `CROSS_REALM_ROLES` once in the backend, next to `RoleEnum`, and mirror it in `src/lib/roles.js`.

## 7. Backend scoping

Every read or write of realm-scoped data filters by the active realm.

- Repository list and query methods take a keyword-only, required `realm_key`, so forgetting it raises a `TypeError` instead of leaking data.
- An id that belongs to another realm behaves exactly like a missing id on that endpoint: the same status and body, so the two can't be told apart.
  - On most endpoints that is 404.
  - Deleting a course or a schedule item has always answered 200 for a missing id and done nothing. It does the same for another realm's id.

| Resource | Scoped by | Where (base commit) |
|---|---|---|
| Sessions, semesters | `academic_sessions.realm_key`; semesters through their session | `modules/calendar/repository.py`, `modules/calendar/service.py`, `api/v1/calendar.py` (endpoints don't receive the user today) |
| Current semester | Per realm | `get_current_semester` (`calendar/repository.py:30`) uses `scalar_one_or_none()` over all semesters, so a second current semester makes it raise. Callers: `timetable/service.py:512`, `:630`, `:921` |
| Courses | `courses.realm_key` | `timetable/repository.py:96` (`get_courses`), `get_course`; `timetable/service.py:322` (create), `:369`, `:373`, `:436` |
| Course semester names and levels | Realm config | The Pydantic validators at `timetable/schemas.py:66-107` and `:145-152` can't see the realm. Keep the code-format validator in the schema; move the semester and level checks into the service |
| Schedule items | `schedule_items.realm_key`; the semester and course must both be the realm's | `timetable/service.py:619` (create), `:682` (update), `:721` (delete); `timetable/repository.py:141` |
| Blocked slots, locks, edit requests | The semester belongs to the realm | `GET /blocked-slots` without `semester_id` returns everything today. Make it default to the realm's current semester |
| Change requests | `change_requests.realm_key` | `timetable/service.py:916` (create), `:997` (list), `:1018` (review) |
| Enrollments | The course belongs to the realm | `timetable/service.py:1099`, `:1119`, `:1146` |
| Conflict dismissals | The realm of `item_a` | `timetable/service.py:1166` returns every dismissal today |
| Notifications to faculty editors | The editor's realm | `auth/repository.py:49` (`get_faculty_editors_in_faculties`), used for priority-override emails |
| Notifications to super admins | They're cross-realm, so the message names the realm | `timetable/service.py:848` and `:970`: prefix the title with the realm name, and add `?realm=KEY` to the link |
| Audit log | `activity_logs.realm_key` | `AuditService.log` sets it from `current_user`; the list returns the active realm plus NULL rows |
| Users, invitations | See §6 | |

Calendar rules:

- `create_session` demotes the sessions and semesters **of the same realm only**. Today `calendar/service.py:10-17` demotes everything, so creating an ICE session would stop UG scheduling.
- `create_semester` requires the session to be in the realm and demotes every semester of the realm, not just of that session. The name must be in `semester_names`.

## 8. Scheduling rules

### 8.1 Window validation (strict realms only)

When `config.strict` is true (ICE), these requests are rejected with 400: creating or updating a schedule item, and change requests with ADD or MODIFY. A request is rejected if:

- a lecture's `day_of_week` is not in `lecture_days`;
- an exam's date falls on a weekday that is not in `exam_days`;
- start < `day_start`, end > `day_end`, or end ≤ start;
- start or end is off the `slot_minutes` grid (for example 19:10 with 15-minute steps).

Blocked slots in strict realms must also fit: a lecture block's day must be in `lecture_days`, and an exam block's date must fall on one of `exam_days`.

UG (`strict: false`) gets no new day or time validation on the server.

### 8.2 Cross-realm room clashes (all realms)

Two schedule items clash across realms when **all** of these hold:

- they are in different realms;
- they are the same type (lecture or exam);
- each is in its realm's current semester;
- they share at least one room id;
- they are in the same slot: the same `day_of_week` for lectures, the same `exam_date` for exams;
- their times overlap (`a.start < b.end and b.start < a.end`). Back-to-back is fine.

Items whose faculty has `is_special = true` are exempt, just as they are within a realm.

The API checks this on create, update and change-request approval and returns 409 naming the other realm, course, room and time. This applies to UG as well, so UG editors can't book a room ICE already holds. The clash can't be ignored or dismissed: one of the two sessions has to move.

### 8.3 Cross-type warnings (UI only)

Semesters have no dates, so the system can't confirm whether UG weekly lectures are still running on a given ICE exam date. These cases warn instead of blocking:

- An exam in room R on date D overlaps another realm's weekly lecture in R on D's weekday.
- A lecture in room R on weekday W overlaps another realm's exams in R on any date that falls on W.

### 8.4 External bookings endpoint

`GET /api/v1/timetable/external-bookings` is open to any signed-in user. It returns the other realms' items in their current semesters, with only these fields:

```json
[{
  "id": 812, "realm_key": "UG", "realm_name": "Undergraduate", "type": "lecture",
  "room_ids": [14], "day_of_week": "Friday", "exam_date": null,
  "start_time": "10:00:00", "end_time": "12:00:00",
  "course_code": "CSC201", "is_special_faculty": false
}]
```

On the frontend, prefix these ids with `ext-` so they never collide with the active realm's ids in conflict maps.

## 9. Frontend

### 9.1 Realm helpers: `src/lib/realm.js` (new)

This must be a pure module, with no `@/` imports and explicit `.js` extensions, so `node --test` can import it. `lib/timetableLayout.js` follows the same pattern. It contains:

- `UG_CONFIG`, identical to the UG seed in §4;
- `getRealmConfig(user)`;
- `hourRange(config)`, the hours from `day_start` up to `day_end`;
- `timeOptions(config)`;
- `minutesFromDayStart(time, config)`;
- `isOutsideWindow(start, end, config)`;
- `isAllowedLectureDay(day, config)`;
- `isAllowedExamDate(dateStr, config)`;
- `weekdayOf(dateStr)`, which must be timezone-safe like `parseLocalDate` in `TimetableGrid.js`.

### 9.2 Realm UX

- **AuthContext:** expose `realm`, `realmName` and `realmConfig` from `/auth/me`. Add `switchRealm(key, redirectTo = '/')`, which POSTs to `/auth/switch-realm` and then does a hard navigation, the same way `assumeRole` does.
- **`/realms`:** load the realms from `GET /realms`. Live realms link to `/login?realm=KEY`; the others show "Coming soon". Fall back to the current static list if the request fails.
- **`/login`:** read the realm from `?realm=` (default UG) and show "{Name} Login" in the badge, which today is hardcoded as "Undergraduate Login" at `login/page.js:37`. Send the realm with the login request and remember it in localStorage. Change the 401 redirect in `lib/apiClient.js:38-46` to go to `/login?realm=<last realm>`.
- **`/register`:** after success, go to `/login?realm=<realm from the query>`.
- **Always show the realm:** the Sidebar brand subtitle (`Sidebar.js:171-172`) shows the realm name, and cross-realm roles get a `RealmSwitcher` in the TopBar, modelled on `RoleSwitcher`.
- **Notification and email links that carry `?realm=KEY`:** if a cross-realm user is in a different realm, call `switchRealm(KEY, path)`.
- **Staff page:** add a realm column. Invites go to the active realm. Show cross-realm roles as "All programmes".
- **Next.js 16:** before using `useSearchParams` or other router APIs, read `node_modules/next/dist/docs/` (see AGENTS.md). `npm run build` must pass.

### 9.3 Replace the hardcoded week with the realm config

| Where (base commit) | Today | Change |
|---|---|---|
| `lib/utils.js:23-27`, `:53-59` | `DAYS`/`EXAM_DAYS` Mon–Sat; `OPERATING_HOURS` 08–18 | Keep the exports as UG defaults, but every caller uses the realm helpers |
| `lib/conflicts.js:232-239`, `:409-416`, `:442` | Outside-hours check fixed at 08–18, and the message hardcodes it | Take the config; the message shows the realm's window |
| `TimetableGrid.js:28` | `HOURS` = 8..18 | `hourRange(config)` |
| `TimetableGrid.js:48-51` | `timeToCol` counts half-hours from 08:00 | Position by minutes from `day_start` |
| `TimetableGrid.js:177-184`, `:482` | Default day `'Monday'`, default time 08:00–10:00 | The first lecture day, and `day_start` plus 2 hours, clamped to the window |
| `TimetableGrid.js:452-456` | Clicking a cell sets end = `min(hour + 2, 18)` | Clamp to `day_end` |
| `TimetableGrid.js:710-726` | Drops past 18:00 are blocked with a "6:00 PM" message | Still blocked, at the realm's `day_end`; build the message from the config |
| `TimetableGrid.js:814-818` | Time options 08–18 in 30-minute steps | `timeOptions(config)` |
| `TimetableGrid.js:934-960` | "+ Add Date" accepts any date | In strict realms, only dates on `exam_days`; show a toast otherwise |
| `TimetableGrid.js:984-1000`, `:1018-1026`, `:1107-1125` | 20 half-hour columns, positions counted in half-hours | Columns from `hourRange`; left and width from minutes (the blocked-slot overlay at `:1060-1078` already works this way) |
| `RequestChangeModal.js:8-14`, `:34`, `:42`, `:73` | 08–18 in 30-minute steps; `DAYS` | From the config |
| `courses/page.js:14-15`, `CourseEnrollmentModal.js:8`, `ExportModal.js:183` | Hardcoded level and semester lists | `config.levels`, `config.semester_names` |
| `terms/page.js:10`, `:206` | Blocked-slot day list; semester options | From the config |
| `csvExport.js:27` | Day order Mon–Sat | `lecture_days` order |
| `Landing.js:331` | Footer link "Undergraduate portal" → `/login` | Point to `/realms` |
| `pdfExport.js` | See §9.5 | |

### 9.4 Timetable grid and external bookings

- The lectures, exams and CBT pages fetch `/timetable/external-bookings` along with the schedule items. They pass the result to `TimetableGrid` and to the conflict check that runs before export.
- Draw external items of the page's own type (lectures on the lectures page, exams on the exam pages) in their rooms as grey, hatched, read-only blocks labelled "{realm} · {code}", clipped to the realm's day window. They are not draggable or clickable, and they don't count towards conflict totals or the day chips.
- `detectConflicts` and `detectAllConflicts` take an options object `{config, externalBookings}`.
  - A same-type overlap with an external item is an error with `{type: 'room', external: true}`. The priority rule never downgrades it, it can't be dismissed, and the save modal shows it without "Ignore & schedule".
  - The cases in §8.3 are warnings.
- So that `node --test` can import `lib/conflicts.js`, change its import from `'./utils'` to `'./utils.js'`.

### 9.5 Exports: today they silently drop ICE data

- **A3 lecture days.** `pdfExport.js:596-600` pushes Monday–Friday (plus Saturday when used), so Sunday classes never appear. Use `lecture_days`. Monday–Friday days in the list always get a column, as today; Saturday and Sunday get one only when they have items, as Saturday works today. (Hiding an empty weekday would change UG exports.)
- **A3 lecture hours.** `:371-374` uses an 8–18 grid that `computeDayRange` widens. Start from the realm's window instead.
- **A3 exam weeks.** `:577-594` builds each week as a Monday plus 6 days, so Sunday exams never appear; the legacy fallback lists Monday–Saturday. Build weeks from `exam_days`.
- **A3 exam slots.** `:555-566` fixes the slots at 9–12, 12–3 and 3–6, and cells are matched with `GRID_START_H + i * SLOT_HOURS` (`:1312-1316`), so exams outside 09–18 vanish. Use `config.exam_slots`, matching on each slot's own start and end.
- **A4 layout.** `START_H` and `END_H` are fixed at 8 and 18 (`:1607-1609`), and the filters at `:1647` and `:2000` drop items that start outside that range, so evening ICE classes vanish. Use the realm window. The day list at `:191` should come from the config.
- **Titles and filenames.** Prefix titles with the realm name for non-UG realms, e.g. "ICE Lecture Timetable", and include the realm key in file names.
- **Nothing is dropped silently.** Anything outside the grid widens it and logs `console.warn`, as the A3 lecture path already does: a day outside the realm's days gets a column, the A4 hour grid grows, and an A3 exam that touches none of the exam slots gets an extra slot before the first or after the last.

## 10. Acceptance criteria

1. With existing UG data after the migration, every UG screen and export behaves as before, and all baseline tests pass.
2. For every realm-scoped resource, UG and ICE users see only their own realm's data. Ids from the other realm behave like missing ids (§7): 404, or a 200 that does nothing when deleting a course or schedule item.
3. Creating an ICE session or semester leaves UG's current semester untouched.
4. The same course code can exist in UG and ICE. A duplicate within one realm returns 400.
5. ICE: a Friday 19:15–20:45 lecture is accepted. Monday returns 400, a 06:45 start returns 400, and a 19:10 start returns 400.
6. With a UG lecture on Friday 10:00–12:00 in room R, an ICE lecture on Friday 11:00–13:00 in R returns 409. The reverse order also returns 409. A different room, Sunday, or a back-to-back 12:00–14:00 slot is accepted.
7. An ICE exam on Sunday at 19:00 shows in the grid, both A3 and A4 PDFs, and the CSV.
8. Logging in to the wrong portal with a realm-bound account returns 403 naming the right portal. A super admin can switch realms. Impersonation keeps the realm.
9. Priority-override emails and notifications reach only editors in the same realm. Notifications to super admins name the realm.
10. `/realms` lists ICE as "Coming soon" until `is_live` is true, and `/login?realm=ICE` works before then.
11. These all pass: `cd backend && uv run pytest`, `npm test`, `npm run lint`, `npm run build`.

## 11. Out of scope and follow-ups

- PG and Foundation are seeded but not live. Enabling one later means writing its config and setting `is_live`.
- A realm settings screen. `PUT /realms/{key}` exists from Phase 1; the UI comes later.
- Showing room usage across realms on the Rooms page.
- Dropping the `'UG'` server defaults after launch.
- Pre-existing issues found during review, for a separate PR:
  - `core/mail.py:116` sends `password_reset_email.html`, but `backend/templates/` has no such file, so forgot-password emails fail outside dev.
  - `GET /export/timetable` returns hardcoded sample data (`modules/export/service.py:23-30`).
  - When a super admin schedules a university-wide course, its `faculty_id` falls back to `faculties[0]` (`TimetableGrid.js:619`, `:633`).
