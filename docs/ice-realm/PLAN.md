# ICE realm — build plan

Run `/ice-realm` in Claude Code. Each run does one phase: it starts the next unfinished phase (or the one you name), verifies it, ticks the boxes here, logs progress, commits on `feature/ice-realm`, and stops. Review the diff, run `/clear`, and repeat.

Phases tagged **[review-first]** stop after posting a plan; reply "go" to continue.

The design is in `SPEC.md`. When this plan and the spec disagree, the spec wins. Fix this plan in the same commit.

## Ground rules for every phase

- Work on `feature/ice-realm`. **Never commit to or push `main`.** A push to main deploys to production and runs migrations on the production database (`.github/workflows/deploy.yml`).
- Only run Alembic or SQL against localhost databases.
- UG behaviour must not change. When in doubt, pin today's UG behaviour with a test before touching the code.
- While working, `uv run pytest -q -m "not slow"` skips the migration round trips. A phase's **Verify** always runs the whole suite (`uv run pytest -q`).
- Stay inside the phase. Anything else goes under Follow-ups below.

---

## Phase 0 — Baseline and test harness

Prerequisites: none.

- [x] Create the branch `feature/ice-realm` from `main`.
- [x] Bring the stack up locally:
  - `cd backend && docker compose up -d` (Postgres on host port **5433**, not 5432).
  - Create `backend/.env` with `DATABASE_URL=postgresql+asyncpg://postgres:password@localhost:5433/unilag_timetable` and a `SECRET_KEY` of 32 or more characters.
  - `uv sync`, `uv run alembic upgrade head`, then `uv run uvicorn main:app --reload`.
  - At the repo root, `npm install && npm run build`.
  - Log anything that fails before changing code. If Docker or uv is missing, stop and say so.
- [x] Add a uv dev dependency group with pytest, pytest-asyncio and httpx. Add `[tool.pytest.ini_options]` with `pythonpath = ["."]`, `testpaths = ["tests"]` and `asyncio_mode = "auto"`. The Dockerfile and CI install with `--no-dev`, so the Lambda image doesn't change.
- [x] Make rate limiting switchable: add `RATE_LIMIT_ENABLED: bool = True` to `Settings` and pass `enabled=settings.RATE_LIMIT_ENABLED` to `Limiter` in `main.py`. Tests turn it off, because slowapi's 60/minute default would fail the suite.
- [x] Add `DB_NULL_POOL: bool = False` to `Settings`. When it's true, `core/database.py` creates the engine with `NullPool`. Tests turn it on, because pooled asyncpg connections break across pytest-asyncio event loops ("attached to a different loop").
- [x] Create `backend/tests/conftest.py`:
  - Before importing the app, set the environment: `DATABASE_URL` pointing at `unilag_timetable_test` on localhost:5433, `SECRET_KEY`, `ENVIRONMENT=dev`, `RATE_LIMIT_ENABLED=false`, `DB_NULL_POOL=true`.
  - Create the test database if it's missing, and run `alembic upgrade head` once per session.
  - Before each test, `TRUNCATE … RESTART IDENTITY CASCADE` every table except `alembic_version` (and `realms` once it exists).
  - Fixtures: an httpx `AsyncClient` over `ASGITransport(app=app)`, `make_user(role, faculty_id=None)`, and `login(client, email, password)`.
- [x] Baseline tests that pin today's behaviour:
  - `/health`;
  - login, then `/auth/me`;
  - a faculty editor creating a course in another faculty's department gets 403;
  - scheduling into a locked lecture timetable gets 423;
  - scheduling into a blocked slot gets 400;
  - creating a new session demotes the previous current semester.
- [x] README: note that local Postgres is on 5433, and explain how to run the backend and frontend tests.

**Verify:** `cd backend && uv run pytest -q`, `npm test`, `npm run lint`, `npm run build`.

---

## Phase 1 — Realms table, config and migration [review-first]

Prerequisites: Phase 0.

- [x] Create `backend/modules/realms/` with `models.py` (`Realm`), `schemas.py` (`RealmConfig`, `ExamSlot`, `RealmResponse`, `RealmUpdate`), `repository.py` and `service.py`. The config rules are in SPEC §4.
- [x] Add the realm-scoped columns to the SQLAlchemy models (SPEC §5), including `server_default="UG"`. On `Course`, drop `unique=True` from `code` and add `UniqueConstraint("realm_key", "code", name="uq_courses_realm_code")`.
- [x] Define `CROSS_REALM_ROLES` next to `RoleEnum`.
- [x] Write one Alembic revision by hand (`down_revision = "m3h4i5j6k7l8"`) that follows SPEC §5 steps 1–7, and import the realms model in `migrations/env.py`. Confirm nothing else is pending with `alembic check` (autogenerate without writing a file) against a scratch database; `tests/test_realm_migration.py` runs it.
- [x] Add `api/v1/realms.py` and mount it in `main.py`:
  - `GET /realms`: public, ordered by `sort_order`, includes the config.
  - `PUT /realms/{key}`: SUPER_ADMIN only; validates the config; writes an audit log entry.

**Verify** with tests:
- Upgrade → downgrade → upgrade on an empty database.
- Legacy backfill: downgrade to `m3h4i5j6k7l8` and insert UG-era rows:
  - a session, a semester, a course, a schedule item and a change request;
  - users, including a SUPER_ADMIN and a FACULTY_EDITOR;
  - an invitation and an activity log.
  Then upgrade to head. Every row has `realm_key = 'UG'`, except cross-realm accounts, which have NULL.
- The same course code can exist in UG and ICE, but not twice in one realm.
- `RealmConfig` rejects:
  - an unknown weekday;
  - `day_end` ≤ `day_start`;
  - a `day_start` that isn't on the hour;
  - `slot_minutes = 7`;
  - exam slots that overlap or leave gaps;
  - an exam slot outside the day window.
- `GET /realms` works signed out; `PUT /realms/ICE` requires SUPER_ADMIN.

---

## Phase 2 — Auth and realm context [review-first]

Prerequisites: Phase 1.

- [x] Login accepts an optional realm, tokens carry a `realm` claim, and `get_current_user` adds `realm`, `realm_name` and `realm_config` (SPEC §6).
- [x] Add `POST /auth/switch-realm`.
- [x] Impersonation keeps the realm.
- [x] Invitations carry the realm, registration copies it, and the invitation email and link include it.
- [x] Scope `GET /auth/users` and `GET /auth/invitations` to the active realm plus cross-realm accounts. Deletes are limited to the same set.
- [x] Seed the super admin in `main.py` with `realm_key = NULL`.
- [x] Add a `realm` parameter to the `make_user` and `login` test fixtures.
- [x] Temporary guard: `require_default_realm` (`api/dependencies/auth.py`) is mounted in `main.py` on the calendar, timetable, export, notifications and audit routers. It returns 403 to any session whose realm isn't UG, so an ICE user can't see UG data before Phase 3 scopes the queries.

**Verify** with tests:
- Logging in to the wrong portal returns 403; logging in to your own portal succeeds.
- When the realm is omitted, a realm-bound user lands in their own realm and a cross-realm user lands in UG.
- A super admin logging in to ICE gets `realm: ICE` and the ICE config from `/auth/me`. `switch-realm` works.
- After an editor is moved to ICE in the database, their next request is in ICE.
- Impersonating inside ICE stays in ICE.
- An invite sent from ICE leads, after registration, to a user with `realm_key = ICE`.
- The staff listing is per realm.
- A session in ICE gets 403 from the guarded routers; UG and signed-out requests are unaffected.

---

## Phase 3 — Scope every backend query by realm

Prerequisites: Phase 2.

- [x] Calendar, following SPEC §7's calendar rules. The endpoints now pass `current_user` through.
- [x] Courses, with the semester and level checks moved into the service and validated against the config.
- [x] Schedule items.
- [x] Blocked slots, locks and edit requests.
- [x] Change requests.
- [x] Enrollments.
- [x] Conflict dismissals.
- [x] Notifications. Editor lookups are per realm, and messages to super admins name the realm with `?realm=` on the link.
- [x] Audit log.
- [x] Every repository list or query method takes a keyword-only, required `realm_key`.
- [x] Remove the Phase 2 guard: take `ug_only` off each router in `main.py` as it gets scoped, then delete `require_default_realm` and its two tests in `tests/test_auth_realm.py`. The export router returns sample data only (SPEC §11), so it is left unguarded: it has no realm data to leak.

**Verify** with tests:
- An isolation matrix: for each resource, create one in UG and one in ICE.
  - Each realm's editor sees only their realm's data.
  - A super admin sees only the realm they're signed in to.
  - Another realm's id behaves exactly like a missing id on every endpoint (SPEC §7): 404, except that deleting a course or schedule item is a 200 that does nothing.
- Creating an ICE session doesn't demote UG's current semester.
- The same course code works across realms.
- Priority-override emails go only to editors in the same realm.

---

## Phase 4 — ICE scheduling rules and shared-room clashes [review-first]

Prerequisites: Phase 3.

- [x] Strict window validation (SPEC §8.1) for schedule items, change requests and blocked slots.
- [x] The cross-realm room clash check (SPEC §8.2) on create, update and change-request approval, returning 409.
- [x] `GET /timetable/external-bookings` (SPEC §8.4).

**Verify** with tests:
- SPEC §10 acceptance criteria 5 and 6.
- `external-bookings` returns only other realms' current-semester items.
- UG gets no new day or time validation: a UG lecture starting at 07:30 is still accepted, as today.

---

## Phase 5 — Frontend realm plumbing

Prerequisites: Phase 4.

- [x] Add `src/lib/realm.js` (SPEC §9.1) and `src/lib/realm.test.mjs`, including a test that `UG_CONFIG` matches today's constants.
- [x] AuthContext exposes the realm fields and `switchRealm`.
- [x] Login flow:
  - `/realms` reads from the API;
  - `/login` reads the realm parameter, shows it in the badge, and remembers it;
  - `/register` redirects to the right portal;
  - the 401 redirect in `apiClient` keeps the realm.
- [x] Show the realm in the Sidebar. Add a `RealmSwitcher` to the TopBar for cross-realm roles.
- [x] Handle notification links that carry `?realm=`.
- [x] Read lists from the realm config:
  - Staff page: realm column; invites go to the active realm.
  - Terms page: semester options and blocked-slot days.
  - Courses page, `CourseEnrollmentModal` and `ExportModal`: levels and semester names.
- [x] Point the Landing page's "Undergraduate portal" link at `/realms`.

**Verify:** `npm test`, `npm run lint`, `npm run build`. Then, manually with the backend running:
- A UG editor sees only UG.
- A super admin switches to ICE and sees an empty ICE workspace.
- `/realms` shows ICE as "Coming soon".
- `/login?realm=ICE` shows the ICE badge.

---

## Phase 6 — Flexible ICE timetable and exports

Prerequisites: Phase 5.

- [x] `lib/conflicts.js`: realm config and external bookings (SPEC §9.4). Unit tests cover:
  - the ICE window;
  - a clash with an external room booking;
  - a cross-type warning;
  - UG output unchanged.
- [x] `TimetableGrid.js`: every grid row of SPEC §9.3, plus drawing external bookings.
- [x] The lectures, exams and CBT pages fetch external bookings, and the pre-export conflict check includes them.
- [x] `RequestChangeModal` reads days and times from the config.
- [x] `pdfExport.js` and `csvExport.js` (SPEC §9.5).
- [x] Local QA data: a script in `backend/scripts/` (this folder is git-ignored) that creates:
  - an ICE session and semester, three ICE courses and an ICE faculty editor;
  - a UG Friday 10:00–12:00 lecture in a shared room;
  - ICE lectures on Friday 19:15–20:45 and Sunday 07:00–09:30;
  - ICE exams on a Saturday and on a Sunday evening.

**Verify:** unit tests, build and lint. Then manual QA with the seed data:
- The grid shows Friday, Saturday and Sunday tabs, runs 07:00–21:00, and offers 15-minute times.
- The UG booking shows in grey in the shared room, and booking over it is blocked.
- The A3 and A4 lecture and exam PDFs and the CSV include the Sunday items.
- UG pages and exports are unchanged: export a UG PDF before and after, and compare.

---

## Phase 7 — Hardening and launch prep

Prerequisites: Phase 6.

- [x] Run `/ice-audit` and fix its findings.
- [ ] Restore a recent production dump into the local Postgres and run `alembic upgrade head`. Smoke-test UG: login, timetables and exports. Never commit the dump.
- [ ] On the restored dump, list any courses whose level isn't in the UG config (`SELECT id, code, level FROM courses WHERE level IS NOT NULL AND level NOT IN (100, 200, 300, 400, 500, 600, 700)`). Since Phase 3 the API rejects those levels, so fix the courses or extend the config's `levels` before launch.
- [x] Add `.github/workflows/test.yml`, triggered on `pull_request`:
  - backend `pytest` with a `postgres:16` service;
  - `npm ci`, lint, test and build.
- [x] Update the README with realms and how to run the tests. Make sure SPEC.md matches what was actually built.
- [ ] Push `feature/ice-realm` and open a PR (`gh pr create` if available). **Don't merge it.**

Launch is for people, not Claude:
1. Merge the PR. CI migrates the database and deploys.
2. A super admin signs in at `/login?realm=ICE` and creates the ICE session and semester.
3. Invite the ICE editors. Their invitations link to the ICE portal.
4. ICE staff enter courses and timetables.
5. Set ICE live with `PUT /api/v1/realms/ICE {"is_live": true}`.
6. Announce it.

---

## Follow-ups

<!-- Claude adds out-of-scope findings here: one line each, with file:line. -->

- `backend/Dockerfile:34` copies the whole folder into the Lambda image and there is no `.dockerignore`, so `backend/tests/` ships with it (harmless: the dev dependencies aren't installed). Add a `.dockerignore`.
- `backend/test_service.py:1` is a leftover manual script, not a test. pytest ignores it (`testpaths = ["tests"]`); delete it or move it to `backend/scripts/`.
- `backend/core/config.py` (`DB_NULL_POOL`): the tests no longer use it, since the suite runs on one event loop with pooled connections. Remove the setting if nothing else needs it.
- `backend/migrations/versions/n4i5j6k7l8m9_add_realms.py:145`: the downgrade doesn't restore the `is_current` flags that step 6 cleared, and only course codes are checked before realms are merged back together. Acceptable while no ICE data exists (SPEC §5 Rollback).
- `backend/modules/auth/models.py:22`: a Python `None` for `realm_key` is left out of the INSERT, so the `'UG'` server default applies. New users and invitations must go through `stored_realm_key()`, which sends an explicit SQL NULL for cross-realm roles. The same trap applies to any other nullable `realm_key` column with a default.
- `backend/api/dependencies/auth.py:21`: `get_current_user` now does one extra primary-key lookup on `realms` per request and validates the config each time. Cache the realms in-process if it shows up in latency.
- `backend/modules/auth/service.py`: changing a user's role is not possible through the API today. If it is added, a move between a cross-realm and a realm-bound role must also set or clear `realm_key`.

- `backend/modules/auth/service.py` (`generate_invite`): `semester_id` on an invitation isn't checked against the inviter's realm. Nothing reads it for scoping today.
- `backend/modules/audit/service.py`: activity logs written by the previous code version during a deploy have `realm_key` NULL, so they show in every realm's audit list. Harmless; backfill to `UG` if it matters.


- `backend/modules/timetable/service.py` (`_assert_no_cross_realm_clash`): nothing in the database enforces the rule, so two saves in different realms at the same moment can both pass. Take a per-room advisory lock (`pg_advisory_xact_lock`) if it ever happens.
- `backend/modules/timetable/service.py` (`_assert_no_cross_realm_clash`): schedule items with `semester_id` NULL (legacy UG rows) count as outside the current semester, so they hold no room across realms and are missing from `external-bookings`. Check on the production dump in Phase 7 whether any are still in use.
- `backend/modules/timetable/service.py` (`_assert_no_cross_realm_clash`): two exams from different realms can never share a room, although two same-faculty exams within a realm can (`src/lib/conflicts.js:148`). This follows SPEC §8.2; relax it there first if ICE and UG need to share exam halls.
- `backend/modules/timetable/service.py` (`create_blocked_slot`): in a strict realm only the day or date is checked (SPEC §8.1), not the block's times. A block applying to both timetables may sit on a lecture day or an exam day.
- `backend/modules/timetable/service.py` (`_assert_fits_window`): a strict realm rejects an exam with no `exam_date` unless its `day_of_week` is an exam day. ICE exams are always dated, so the Phase 6 UI should always send the date.

- `src/components/RealmSwitcher/RealmSwitcher.js`: lists every realm, so a cross-realm user can enter the PG and Foundation placeholders (tagged "Not live", like ICE before launch). Hide them once there is a way to tell a placeholder from a realm being set up.
- `src/components/ClientLayout/ClientLayout.js`: a signed-in user who opens `/login?realm=KEY` is sent to the dashboard in the realm they are already in; a cross-realm user then has to use the switcher.
- `src/app/terms/page.js`: the blocked-slot form doesn't check an exam block's date against `exam_days` before sending. A strict realm's API rejects it and the page shows the API's message; `isAllowedExamDate` in `src/lib/realm.js` is ready for a client-side check.
- `src/app/terms/page.js`: the blocked-slot day list now comes from `lecture_days` (SPEC §9.3), so UG no longer offers Sunday there. UG has no Sunday tab in the grid, so such a block had no effect.
- `src/components/ExportModal/ExportModal.js`: the level filter now lists the realm's levels (SPEC §9.3), so UG gains 600 and 700 next to 100–500.

- `src/components/TimetableGrid/TimetableGrid.js`: an item that starts before the realm's `day_start` (or at or after `day_end`) is not drawn in the grid, as before this phase; it still shows in the exports and the conflict list. Only non-strict realms (UG) can hold such items.
- `src/components/TimetableGrid/TimetableGrid.js`: another realm's booking is drawn only on the same kind of timetable and inside this realm's day window, so a UG editor doesn't see ICE's evening sessions (the API still answers 409 and names them). A lecture against another realm's exam only raises a warning (SPEC §8.3) and is not drawn.
- `src/lib/timetableLayout.js` (`computeDayRange`): the A3/A4 lecture grid rounds to even hours, so ICE's 07:00–21:00 day prints as 06:00–22:00.
- `src/lib/pdfExport.js` (`getExportFileName`): the lecture PDF's file name always ends `_a3`, even on A4 paper. Unchanged from before this phase.
- `src/lib/pdfExport.js` (A3 exam weeks): exams without a date are left out as soon as one exam has a date. Unchanged from before this phase; ICE exams are always dated.
- `src/app/timetable/*/page.js`: the conflict check before export now includes external bookings, but it is still switched off by `SHOW_CONFLICTS_BEFORE_EXPORT = false`, as before.
- `backend/scripts/seed_ice_qa.py` is git-ignored with the rest of `backend/scripts/`, so it exists only on the machine that ran Phase 6. Copy it into the repo (for example under `backend/tests/`) if others need it.

- `backend/modules/timetable/service.py` (`create_change_request`): a MODIFY or REMOVE request doesn't check that the target item's course is the `course_id` it names, so a faculty user can name one of their own courses to pass the scope check while targeting another faculty's item in the same realm. A super admin still has to approve it. Reject with 400 when the two differ. (ice-audit 2026-10-09)
- `backend/modules/auth/repository.py` (`get_user_by_id`, `get_invitation_by_id`): the delete paths look the account up without a realm and check it afterwards in the service. Correct today; give them realm-scoped lookups so a new caller can't skip the check. (ice-audit 2026-10-09)
- `backend/modules/timetable/service.py` (`delete_room`, `delete_faculty`): a shared room or faculty that only another realm uses can't be deleted, and the message doesn't say another programme is the reason. (ice-audit 2026-10-09)
- `.github/workflows/test.yml` runs only on pull requests, and `deploy.yml` doesn't wait for it: a direct push to `main` deploys untested. Protect `main` and require the two test jobs.

## Progress log

<!-- Claude appends one line per finished phase: YYYY-MM-DD · Phase N · what changed · test results -->

2026-10-08 · Phase 0 · pytest harness (dev dependency group, `RATE_LIMIT_ENABLED`, `DB_NULL_POOL`, `tests/conftest.py`), 7 baseline tests pinning UG behaviour, README test and port notes · backend `pytest` 7 passed; `npm test` 10 passed; `npm run lint` 0 errors (20 existing warnings); `npm run build` OK
2026-10-08 · Phase 1 · `modules/realms` (model, `RealmConfig`, repository, service), `GET /realms` and `PUT /realms/{key}`, `realm_key` columns on the models, `CROSS_REALM_ROLES`, revision `n4i5j6k7l8m9` (SPEC §5 steps 1–7) · backend `pytest` 42 passed (7 baseline unchanged), including upgrade → downgrade → upgrade, legacy backfill and `alembic check`
2026-10-08 · Phase 2 · login takes a realm, tokens carry `realm`, `get_current_user` returns `realm`/`realm_name`/`realm_config`, `POST /auth/switch-realm`, impersonation keeps the realm, invitations and registration carry the realm (email and link name the portal), staff listings and deletes per realm, seeded super admin has no realm, temporary UG-only guard on the unscoped routers · backend `pytest` 72 passed (42 existing unchanged, 30 new in `tests/test_auth_realm.py`)
2026-10-09 · Phase 3 · every realm-scoped query filters by the active realm (calendar, courses, schedule items, blocked slots, locks, edit requests, change requests, enrollments, conflict dismissals, audit log); repository reads take a required keyword-only `realm_key`; course level and semester checked against the realm config in the service; priority-override notifications reach only the same realm's editors and notifications to super admins name the realm; Phase 2 guard removed · backend `pytest` 84 passed (70 existing unchanged, the 2 guard tests removed, 14 new in `tests/test_realm_isolation.py`); frontend untouched, so npm checks not re-run
2026-10-09 · Phase 3 follow-up · another realm's id now behaves exactly like a missing id on every endpoint (course and schedule-item deletes answer 200 and do nothing; SPEC §7 updated, test added); test suite sped up: one event loop with pooled connections instead of a new connection per request, tables emptied with DELETE instead of TRUNCATE, `BCRYPT_ROUNDS` setting (default 12, 4 in tests), migration tests marked `slow`; Phase 7 gains a check for course levels outside the UG config · backend `pytest` 83 passed (the two 404 tests merged into one that compares against a missing id); full suite about 10.5 minutes before, 66–107 seconds after; `-m "not slow"` 37 seconds
2026-10-09 · Phase 4 · strict realms (ICE) reject schedule items, ADD/MODIFY change requests and blocked slots outside the realm's days, day window or time grid (400); a same-type session in a room another realm holds at an overlapping time in its current semester is refused on create, update and change-request approval (409, special faculties exempt); `GET /timetable/external-bookings`; UG gets no new validation · backend `pytest` 106 passed (83 existing, 23 new in `tests/test_ice_scheduling.py`; two fixtures in `tests/test_realm_isolation.py` moved onto ICE days, assertions unchanged); frontend untouched, so npm checks not re-run
2026-10-09 · Phase 5 · `src/lib/realm.js` (UG config, window/day/date helpers, portal links) with tests; AuthContext exposes `realm`/`realmName`/`realmConfig` and `switchRealm`; `/realms` reads the API (static fallback), `/login` reads `?realm=`, shows it in the badge and sends it, `/register` returns to the invitation's portal, the 401 and sign-out redirects keep the realm; Sidebar names the realm and cross-realm roles get a `RealmSwitcher`; links carrying `?realm=` switch a cross-realm user; staff page has a Programme column; terms, courses, enrolment and export lists come from the realm config; Landing footer link points at `/realms` · `npm test` 19 passed (9 new in `realm.test.mjs`); `npm run lint` 0 errors (20 warnings, as before); `npm run build` OK; manual checks run in headless Edge against a local backend on the test database, 22/22 (UG editor sees only UG and is refused on the ICE login, super admin switches to an empty ICE workspace, `/realms` shows ICE as "Coming soon", `/login?realm=ICE` shows the ICE badge); backend untouched, so pytest not re-run
2026-10-09 · Phase 6 · the timetable grid, schedule and change-request forms, conflict checks and PDF/CSV exports read days, hours, time steps and exam slots from the realm config; other realms' room bookings are fetched on the lectures, exams and CBT pages, drawn grey and read-only, and block saving on a same-type overlap (a lecture against an exam only warns); exports print Sunday and evening sessions, name non-UG realms in titles and file names, and widen instead of dropping anything outside the grid; `backend/scripts/seed_ice_qa.py` seeds local QA data · `npm test` 27 passed (8 new in `conflicts.test.mjs`); `npm run lint` 0 errors (20 warnings, as before); `npm run build` OK; old and new conflict engines agree on 400 random UG timetables; 64 UG PDF exports (A3/A4, lectures/exams, colour/mono) and the UG CSVs are byte-identical to the previous commit, and the ICE A3/A4 PDFs and CSV contain the Sunday and 19:00 items; manual checks in headless Edge against a local backend with the seed data, 37/37; backend untouched, so pytest not re-run
2026-10-09 · Phase 7 (partial) · `/ice-audit` found no realm leak (no blockers); fixed its findings and the three left from the previous audit: a shared department can't be deleted while another realm has enrollments for it, an ADD change request stores no target item, only a super admin reads invitation tokens, a realm update is logged under the realm that changed, and a cross-realm requester's review notification names the realm; `.github/workflows/test.yml` runs pytest (Postgres 16 service), lint, unit tests and build on pull requests; README gains a realms section; SPEC.md brought in line with the build. Not done: the production-dump restore, smoke test and course-level check (no dump on this machine), and opening the PR (`gh` is not installed) · backend `pytest` 110 passed (106 existing, 4 new), also 110 passed on a fresh `postgres:16` container set up like the CI job; `npm test` 27 passed; `npm run lint` 0 errors (20 warnings, as before); `npm run build` OK; the workflow itself first runs when the PR is opened
