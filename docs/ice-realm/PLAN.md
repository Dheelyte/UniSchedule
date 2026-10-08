# ICE realm — build plan

Run `/ice-realm` in Claude Code. Each run does one phase: it starts the next unfinished phase (or the one you name), verifies it, ticks the boxes here, logs progress, commits on `feature/ice-realm`, and stops. Review the diff, run `/clear`, and repeat.

Phases tagged **[review-first]** stop after posting a plan; reply "go" to continue.

The design is in `SPEC.md`. When this plan and the spec disagree, the spec wins. Fix this plan in the same commit.

## Ground rules for every phase

- Work on `feature/ice-realm`. **Never commit to or push `main`.** A push to main deploys to production and runs migrations on the production database (`.github/workflows/deploy.yml`).
- Only run Alembic or SQL against localhost databases.
- UG behaviour must not change. When in doubt, pin today's UG behaviour with a test before touching the code.
- Stay inside the phase. Anything else goes under Follow-ups below.

---

## Phase 0 — Baseline and test harness

Prerequisites: none.

- [ ] Create the branch `feature/ice-realm` from `main`.
- [ ] Bring the stack up locally:
  - `cd backend && docker compose up -d` (Postgres on host port **5433**, not 5432).
  - Create `backend/.env` with `DATABASE_URL=postgresql+asyncpg://postgres:password@localhost:5433/unilag_timetable` and a `SECRET_KEY` of 32 or more characters.
  - `uv sync`, `uv run alembic upgrade head`, then `uv run uvicorn main:app --reload`.
  - At the repo root, `npm install && npm run build`.
  - Log anything that fails before changing code. If Docker or uv is missing, stop and say so.
- [ ] Add a uv dev dependency group with pytest, pytest-asyncio and httpx. Add `[tool.pytest.ini_options]` with `pythonpath = ["."]`, `testpaths = ["tests"]` and `asyncio_mode = "auto"`. The Dockerfile and CI install with `--no-dev`, so the Lambda image doesn't change.
- [ ] Make rate limiting switchable: add `RATE_LIMIT_ENABLED: bool = True` to `Settings` and pass `enabled=settings.RATE_LIMIT_ENABLED` to `Limiter` in `main.py`. Tests turn it off, because slowapi's 60/minute default would fail the suite.
- [ ] Add `DB_NULL_POOL: bool = False` to `Settings`. When it's true, `core/database.py` creates the engine with `NullPool`. Tests turn it on, because pooled asyncpg connections break across pytest-asyncio event loops ("attached to a different loop").
- [ ] Create `backend/tests/conftest.py`:
  - Before importing the app, set the environment: `DATABASE_URL` pointing at `unilag_timetable_test` on localhost:5433, `SECRET_KEY`, `ENVIRONMENT=dev`, `RATE_LIMIT_ENABLED=false`, `DB_NULL_POOL=true`.
  - Create the test database if it's missing, and run `alembic upgrade head` once per session.
  - Before each test, `TRUNCATE … RESTART IDENTITY CASCADE` every table except `alembic_version` (and `realms` once it exists).
  - Fixtures: an httpx `AsyncClient` over `ASGITransport(app=app)`, `make_user(role, faculty_id=None)`, and `login(client, email, password)`.
- [ ] Baseline tests that pin today's behaviour:
  - `/health`;
  - login, then `/auth/me`;
  - a faculty editor creating a course in another faculty's department gets 403;
  - scheduling into a locked lecture timetable gets 423;
  - scheduling into a blocked slot gets 400;
  - creating a new session demotes the previous current semester.
- [ ] README: note that local Postgres is on 5433, and explain how to run the backend and frontend tests.

**Verify:** `cd backend && uv run pytest -q`, `npm test`, `npm run lint`, `npm run build`.

---

## Phase 1 — Realms table, config and migration [review-first]

Prerequisites: Phase 0.

- [ ] Create `backend/modules/realms/` with `models.py` (`Realm`), `schemas.py` (`RealmConfig`, `ExamSlot`, `RealmResponse`, `RealmUpdate`), `repository.py` and `service.py`. The config rules are in SPEC §4.
- [ ] Add the realm-scoped columns to the SQLAlchemy models (SPEC §5), including `server_default="UG"`. On `Course`, drop `unique=True` from `code` and add `UniqueConstraint("realm_key", "code", name="uq_courses_realm_code")`.
- [ ] Define `CROSS_REALM_ROLES` next to `RoleEnum`.
- [ ] Write one Alembic revision by hand (`down_revision = "m3h4i5j6k7l8"`) that follows SPEC §5 steps 1–7, and import the realms model in `migrations/env.py`. Run `alembic revision --autogenerate` against a scratch database to confirm nothing else is pending, then delete the generated file.
- [ ] Add `api/v1/realms.py` and mount it in `main.py`:
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

- [ ] Login accepts an optional realm, tokens carry a `realm` claim, and `get_current_user` adds `realm`, `realm_name` and `realm_config` (SPEC §6).
- [ ] Add `POST /auth/switch-realm`.
- [ ] Impersonation keeps the realm.
- [ ] Invitations carry the realm, registration copies it, and the invitation email and link include it.
- [ ] Scope `GET /auth/users` and `GET /auth/invitations` to the active realm plus cross-realm accounts.
- [ ] Seed the super admin in `main.py` with `realm_key = NULL`.
- [ ] Add a `realm` parameter to the `make_user` and `login` test fixtures.

**Verify** with tests:
- Logging in to the wrong portal returns 403; logging in to your own portal succeeds.
- When the realm is omitted, a realm-bound user lands in their own realm and a cross-realm user lands in UG.
- A super admin logging in to ICE gets `realm: ICE` and the ICE config from `/auth/me`. `switch-realm` works.
- After an editor is moved to ICE in the database, their next request is in ICE.
- Impersonating inside ICE stays in ICE.
- An invite sent from ICE leads, after registration, to a user with `realm_key = ICE`.
- The staff listing is per realm.

---

## Phase 3 — Scope every backend query by realm

Prerequisites: Phase 2.

- [ ] Calendar, following SPEC §7's calendar rules. The endpoints now pass `current_user` through.
- [ ] Courses, with the semester and level checks moved into the service and validated against the config.
- [ ] Schedule items.
- [ ] Blocked slots, locks and edit requests.
- [ ] Change requests.
- [ ] Enrollments.
- [ ] Conflict dismissals.
- [ ] Notifications. Editor lookups are per realm, and messages to super admins name the realm with `?realm=` on the link.
- [ ] Audit log.
- [ ] Every repository list or query method takes a keyword-only, required `realm_key`.

**Verify** with tests:
- An isolation matrix: for each resource, create one in UG and one in ICE.
  - Each realm's editor sees only their realm's data.
  - A super admin sees only the realm they're signed in to.
  - Cross-realm get, update and delete all return 404.
- Creating an ICE session doesn't demote UG's current semester.
- The same course code works across realms.
- Priority-override emails go only to editors in the same realm.

---

## Phase 4 — ICE scheduling rules and shared-room clashes [review-first]

Prerequisites: Phase 3.

- [ ] Strict window validation (SPEC §8.1) for schedule items, change requests and blocked slots.
- [ ] The cross-realm room clash check (SPEC §8.2) on create, update and change-request approval, returning 409.
- [ ] `GET /timetable/external-bookings` (SPEC §8.4).

**Verify** with tests:
- SPEC §10 acceptance criteria 5 and 6.
- `external-bookings` returns only other realms' current-semester items.
- UG gets no new day or time validation: a UG lecture starting at 07:30 is still accepted, as today.

---

## Phase 5 — Frontend realm plumbing

Prerequisites: Phase 4.

- [ ] Add `src/lib/realm.js` (SPEC §9.1) and `src/lib/realm.test.mjs`, including a test that `UG_CONFIG` matches today's constants.
- [ ] AuthContext exposes the realm fields and `switchRealm`.
- [ ] Login flow:
  - `/realms` reads from the API;
  - `/login` reads the realm parameter, shows it in the badge, and remembers it;
  - `/register` redirects to the right portal;
  - the 401 redirect in `apiClient` keeps the realm.
- [ ] Show the realm in the Sidebar. Add a `RealmSwitcher` to the TopBar for cross-realm roles.
- [ ] Handle notification links that carry `?realm=`.
- [ ] Read lists from the realm config:
  - Staff page: realm column; invites go to the active realm.
  - Terms page: semester options and blocked-slot days.
  - Courses page, `CourseEnrollmentModal` and `ExportModal`: levels and semester names.
- [ ] Point the Landing page's "Undergraduate portal" link at `/realms`.

**Verify:** `npm test`, `npm run lint`, `npm run build`. Then, manually with the backend running:
- A UG editor sees only UG.
- A super admin switches to ICE and sees an empty ICE workspace.
- `/realms` shows ICE as "Coming soon".
- `/login?realm=ICE` shows the ICE badge.

---

## Phase 6 — Flexible ICE timetable and exports

Prerequisites: Phase 5.

- [ ] `lib/conflicts.js`: realm config and external bookings (SPEC §9.4). Unit tests cover:
  - the ICE window;
  - a clash with an external room booking;
  - a cross-type warning;
  - UG output unchanged.
- [ ] `TimetableGrid.js`: every grid row of SPEC §9.3, plus drawing external bookings.
- [ ] The lectures, exams and CBT pages fetch external bookings, and the pre-export conflict check includes them.
- [ ] `RequestChangeModal` reads days and times from the config.
- [ ] `pdfExport.js` and `csvExport.js` (SPEC §9.5).
- [ ] Local QA data: a script in `backend/scripts/` (this folder is git-ignored) that creates:
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

- [ ] Run `/ice-audit` and fix its findings.
- [ ] Restore a recent production dump into the local Postgres and run `alembic upgrade head`. Smoke-test UG: login, timetables and exports. Never commit the dump.
- [ ] Add `.github/workflows/test.yml`, triggered on `pull_request`:
  - backend `pytest` with a `postgres:16` service;
  - `npm ci`, lint, test and build.
- [ ] Update the README with realms and how to run the tests. Make sure SPEC.md matches what was actually built.
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

## Progress log

<!-- Claude appends one line per finished phase: YYYY-MM-DD · Phase N · what changed · test results -->
