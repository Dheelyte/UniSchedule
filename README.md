# UniSchedule - University of Lagos Timetable Manager

UniSchedule is the timetable manager for the University of Lagos, live at **[www.unilagtimetable.com](https://www.unilagtimetable.com/)**. Timetable officers build lecture, exam and CBT timetables on a drag-and-drop grid, and the app checks every placement for clashes. The frontend is Next.js 16 (React 19); the FastAPI (Python) backend holds the data, access control and scheduling rules.

## Features

- **Lecture, exam and CBT timetables**, one per semester, with blocked slots and holidays set on the academic calendar.
- **Conflict detection** for rooms, departments and levels as items are placed. University-wide courses take priority over interfaculty courses, which take priority over departmental ones. Several exams can share a venue at the same time.
- **Programmes (realms)**: each programme (Undergraduate, ICE part-time, …) has its own calendar, rooms, courses and staff. See [Realms](#realms-programmes).
- **Locking and change requests**: a Super Admin marks a timetable FINAL to stop edits, and a Faculty Editor can ask for it to be reopened. While a timetable is open, faculty staff send change requests to the super admins.
- **Signed, stamped and verifiable FINAL PDFs**: every timetable page of a FINAL PDF carries the official stamp, the signatory's signature, name and title, and a QR code and link to `/verify/<code>`, where anyone can check the copy is genuine and still current. Draft PDFs get a DRAFT watermark instead. See [Signatures and verification](#signatures-and-verification).
- **Exports** to PDF (A3 or A4, colour or black and white, a week grid or one day per page for lectures) and CSV, filtered by session, semester, faculty, department and level.
- **Import** (beta, Super Admin): read a faculty's existing timetable from an Excel (.xlsx) or Word (.docx) file, or copy an earlier semester. Each import is previewed and checked for clashes before it is saved, and can be reverted.
- **Staff invitations, roles and an activity log.**

## Project Structure

- `/` (root): Next.js frontend web application
- `/backend`: Python FastAPI server and database management
- `/docs`: design documents (see `docs/ice-realm/`)

## Prerequisites

- Node.js (>= 18.x) and npm
- Python (>= 3.12)
- PostgreSQL, or Docker to run the database container
- `uv` (fast Python package installer), or `pip`

## Getting Started

### 1. Backend Setup

1. Go to the backend directory:

   ```bash
   cd backend
   ```

2. Start the PostgreSQL database:

   ```bash
   docker compose up -d
   ```

   The container publishes Postgres on host port **5433** (not the default 5432), so it doesn't clash with a Postgres already installed on your machine.

   _(Alternatively, configure a local PostgreSQL instance with credentials matching `core/config.py`.)_

3. Create the virtual environment and install dependencies (using `uv` is recommended):

   ```bash
   uv venv
   source .venv/bin/activate
   uv sync
   ```

4. Create a `.env` file inside `/backend`:

   ```env
   DATABASE_URL=postgresql+asyncpg://postgres:password@localhost:5433/unilag_timetable
   SECRET_KEY=a_random_string_of_at_least_32_characters
   DEFAULT_SUPER_ADMIN_EMAIL=admin@email.com
   DEFAULT_SUPER_ADMIN_PASSWORD=adminpassword
   FRONTEND_URL=http://localhost:3000
   ```

   Every other setting in `core/config.py` (cookies, CORS, allowed hosts, email) has a default that works locally. `DEBUG` is on by default, which also turns off the allowed-hosts check.

   > **Security:** these values are for local development only. Never commit `.env` (make sure it is in `.gitignore`), and use a strong, unique `SECRET_KEY`, database password and super admin password in any shared or deployed environment.

5. Run database migrations:

   ```bash
   uv run alembic upgrade head
   ```

6. Start the FastAPI server:

   ```bash
   uv run uvicorn main:app --reload
   ```

   The API is available at `http://localhost:8000`.

### 2. Frontend Setup

1. In a new terminal, go to the project root:

   ```bash
   cd UniSchedule
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Optional: the frontend calls the API at `http://localhost:8000/api/v1` by default. To point it elsewhere, create `.env.local` in the project root:

   ```env
   NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser and sign in with the `DEFAULT_SUPER_ADMIN_*` account from the backend `.env`.

## Roles

| Role | Scope | Access |
|---|---|---|
| Super Admin | All realms, all faculties | Full access. Locks timetables, manages staff and the signatures and stamps on FINAL PDFs, and can **View as** any other role to check what they see. |
| Super Viewer | All realms, all faculties | Read-only; can request changes. |
| Super Administrator (CITS) | All realms | Manages the CBT timetable. |
| GS Admin | One realm | Manages General Studies (GST/ENT) courses. |
| Faculty Editor | One faculty | Edits the faculty's timetables; invites DEOs to the faculty. |
| Faculty Viewer | One faculty | Read-only; can request changes. |
| Departmental Examination Officer (DEO) | One faculty | Read-only; can export. |

Role lists live in `src/lib/roles.js` and `backend/modules/auth/`; keep the two in step.

## Realms (programmes)

The app serves more than one programme. Each one is a **realm** with its own faculties, departments, rooms, academic calendar, courses, timetables, change requests, audit log and staff. Nothing is shared between realms.

| Key | Programme | Week |
|---|---|---|
| `UG` | Undergraduate | Monday to Saturday, 08:00 to 18:00, 30-minute steps |
| `ICE` | ICE (part-time) | Lectures any day, exams Friday to Sunday; 07:00 to 21:00, 15-minute steps; the API rejects anything outside |
| `PG`, `FOUNDATION` | Placeholders | Copies of the UG settings, not in use |

- **Portals.** `/realms` lists the programmes and each one signs in at `/login?realm=KEY`. A realm whose `is_live` flag is off shows as "Coming soon" on `/realms`, but its login page still works, so staff can set it up before launch.
- **Accounts.** Super Admin, Super Viewer and CITS Admin work across realms: they choose one at login and can switch from the top bar. Every other role belongs to one realm, the one its invitation was sent from. One email is one account.
- **Settings.** A realm's days, hours, time step, exam slots, levels and semester names are stored in `realms.config`. `GET /api/v1/realms` returns them and a Super Admin changes them with `PUT /api/v1/realms/{key}`; there is no settings screen yet. The frontend reads them through `src/lib/realm.js`.
- **Same physical hall.** Each realm has its own rooms. On its Rooms page, a realm other than Undergraduate adds the Undergraduate rooms it also uses ("Add from Undergraduate"); each becomes a room of its own, linked to the original as the same hall. "Create new room" makes a room that only that realm has. Two lectures, or two exams, from different realms can't overlap in a linked hall: the API answers 409 and the grid shows the other realm's booking in grey. Rooms that aren't linked never clash across realms.
- **Design.** `docs/ice-realm/SPEC.md` has the full design and `docs/ice-realm/PLAN.md` the build log.

## Signatures and verification

FINAL (locked) timetables are exported signed; drafts are watermarked.

- **Setting it up.** A Super Admin opens **Signatures & Stamps** in the sidebar (`/signoffs`). Each programme has two sign-offs, one for lecture timetables and one for exam timetables (CBT timetables use the exam one). Each has the signatory's name and title (the Vice-Chancellor until set otherwise) and a scanned signature and stamp. Uploads are cleaned up in the browser: the paper background is made transparent, the edges trimmed and large photos scaled down, so scan on plain white paper.
- **Exports.** Every timetable page of a FINAL PDF (lecture, exam, CBT; A3, A4 and one day per page) gets a strip above the footer: the QR code, link and verification code on the left, the stamp, signature, name and title on the right. The cover page only says what is inside, so it carries the QR code and link but no stamp or signature. CSV exports are not signed.
- **Verification codes.** Locking a timetable issues a code such as `UG-7K3P-92QD`. Unlocking marks it reopened; locking again issues a new code. The public page `/verify/<code>` (or `/verify` to type one in) shows the programme, session, semester and timetable type, when it was marked FINAL, and whether it is **current**, **reopened** (may be out of date) or **superseded** by a newer FINAL version. It never shows the signature or stamp. Verify pages are kept out of search results.
- **Why the code matters.** PDFs are built in the browser, so anyone who can export a FINAL timetable receives the signature and stamp images and could copy them. The verification code is the real check: a forged or outdated copy either has no code or one that doesn't match.
- **Storage.** Sign-offs live in `timetable_signoffs` and issued codes in `timetable_verifications` (`backend/modules/signoff/`). Both are realm-scoped; only looking a code up is cross-realm, by design.

## Running the Tests

Pull requests run all of the checks below in GitHub Actions (`.github/workflows/test.yml`).

### Backend

The backend tests need the Postgres container from the backend setup to be running. They never touch your development data: they create and migrate their own database, `unilag_timetable_test`, on `localhost:5433`, and empty its tables before every test.

```bash
cd backend
uv sync                           # installs the dev group (pytest, pytest-asyncio, httpx)
uv run pytest -q                  # everything, about 1-2 minutes
uv run pytest -q -m "not slow"    # skips the migration round trips, under a minute
```

Run everything before you commit. The `slow` tests run Alembic up and down on a scratch database.

To use a different Postgres, set `TEST_DATABASE_URL`. It must be on localhost and the database name must end with `_test`.

### Frontend

From the project root:

```bash
npm test         # unit tests (node --test)
npm run lint
npm run build
```

## Deployment

Pushing to `main` deploys the backend to production (`.github/workflows/deploy.yml`): it runs `alembic upgrade head` against the production database, then builds the Docker image and ships it to AWS Lambda. Because migrations run before the new code is live, they must stay additive and work with the previous version of the code.

The frontend is served at `https://www.unilagtimetable.com` and calls the API at `https://backend.unilagtimetable.com/api/v1` (its `NEXT_PUBLIC_API_URL`). The backend's production settings are environment variables on the Lambda, not in this repo. They must name that domain:

```env
ENVIRONMENT=prod
DEBUG=false
FRONTEND_URL=https://www.unilagtimetable.com            # links in invitation and notification emails
CORS_ALLOWED_ORIGINS=["https://www.unilagtimetable.com"]
ALLOWED_HOSTS=["backend.unilagtimetable.com"]
```

## Contributing

Contributions are welcome:

1. Clone the repository and create a branch (`git checkout -b feat/your-feature` or `fix/your-fix`). Never push straight to `main`: it deploys to production.
2. Make your changes and run the tests above.
3. Commit with descriptive messages.
4. Push your branch and open a Pull Request.

## Authors

Profiles are also on the app's `/contributors` page, linked from the home page footer.

- Delight Olu-Olagbuji ([@Dheelyte](https://github.com/Dheelyte), [LinkedIn](https://www.linkedin.com/in/delight-olu-olagbuji-990b61314))
- Olatunde David Durojaiye ([@rubiks001](https://github.com/rubiks001))
- Emmanuel Maduakor ([@maduakoremmanuel](https://github.com/maduakoremmanuel))
- Gospel Ugwuja ([@devyalchemist](https://github.com/devyalchemist))
- Oluwapelumi Kolawole ([@Peakay6](https://github.com/Peakay6))
- Muhiz Akanni ([@muakone](https://github.com/muakone))
- Wisdom Ede ([@Edebros2](https://github.com/Edebros2))
