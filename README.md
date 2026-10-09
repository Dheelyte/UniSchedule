# UniSchedule - University of Lagos Timetable Manager

UniSchedule is a comprehensive timetable management application for the University of Lagos. It features a Next.js 16 React frontend and a FastAPI (Python) backend to handle complex scheduling logic, access control, and PDF exports.

## Project Structure

- `/` (Root): Next.js frontend web application
- `/backend`: Python FastAPI server and database management

## Prerequisites

Before setting up the project, assure you have the following installed:

- Node.js (>= 18.x) and npm
- Python (>= 3.12)
- PostgeSQL or Docker (for running the database container)
- `uv` (Fast Python package installer) or `pip`

## Getting Started

### 1. Backend Setup

The backend logic and database are managed within the `backend/` directory.

1. Navigate to the backend directory:

   ```bash
   cd backend
   ```

2. Start the PostgreSQL database:

   ```bash
   docker compose up -d
   ```

   The container publishes Postgres on host port **5433** (not the default 5432), so it doesn't clash with a Postgres already installed on your machine.

   _(Alternatively, configure a local PostgreSQL instance with credentials matching `core/config.py`)_

3. Create the virtual environment and install dependencies using `uv` (recommended):

   ```bash
   uv venv
   source .venv/bin/activate
   uv sync
   # or with standard pip: pip install -r requirements.txt (if available)
   ```

4. Provide environment variables:
   Create a `.env` file inside `/backend` with the following variables:

   ```env
   DATABASE_URL=postgresql+asyncpg://postgres:password@localhost:5433/unilag_timetable
   SECRET_KEY=a_random_string_of_at_least_32_characters
   DEFAULT_SUPER_ADMIN_EMAIL=admin@email.com
   DEFAULT_SUPER_ADMIN_PASSWORD=adminpassword
   FRONTEND_URL=http://localhost:3000
   ```

5. Run database migrations:

   ```bash
   uv run alembic upgrade head
   ```

6. Start the FastAPI server:
   ```bash uv run uvicorn main:app --reload
  
   ```
   The backend API will be available at `http://localhost:8000`.

### 2. Frontend Setup

The frontend is a Next.js application located at the project root.

1. In a new terminal, navigate to the project root:

   ```bash
   cd unilag-timetable
   ```

2. Install npm dependencies:

   ```bash
   npm install
   ```

3. Run the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) with your browser to launch the application.

## Realms (programmes)

The app serves more than one programme. Each one is a **realm** with its own academic calendar, courses, timetables, change requests, audit log and staff. Faculties, departments and rooms are shared by every realm.

| Key | Programme | Week |
|---|---|---|
| `UG` | Undergraduate | Monday to Saturday, 08:00 to 18:00, 30-minute steps |
| `ICE` | ICE (part-time) | Friday to Sunday, 07:00 to 21:00, 15-minute steps; the API rejects anything outside |
| `PG`, `FOUNDATION` | Placeholders | Copies of the UG settings, not in use |

- **Portals.** `/realms` lists the programmes and each one signs in at `/login?realm=KEY`. A realm whose `is_live` flag is off shows as "Coming soon" on `/realms`, but its login page still works, so staff can set it up before launch.
- **Accounts.** Super Admin, Super Viewer and CITS Admin work across realms: they choose one at login and can switch from the top bar. Every other role belongs to one realm, the one its invitation was sent from. One email is one account.
- **Settings.** A realm's days, hours, time step, exam slots, levels and semester names are stored in `realms.config`. `GET /api/v1/realms` returns them and a Super Admin changes them with `PUT /api/v1/realms/{key}`; there is no settings screen yet. The frontend reads them through `src/lib/realm.js`.
- **Shared rooms.** Two lectures, or two exams, from different realms can't overlap in the same room. The API answers 409 and the grid shows the other realm's booking in grey.
- **Design.** `docs/ice-realm/SPEC.md` has the full design and `docs/ice-realm/PLAN.md` the build log.

## Running the Tests

Pull requests run all of the checks below in GitHub Actions (`.github/workflows/test.yml`).

### Backend

The backend tests need the Postgres container from step 2 above to be running. They never touch your development data: they create and migrate their own database, `unilag_timetable_test`, on `localhost:5433`, and empty its tables before every test.

```bash
cd backend
uv sync            # installs the dev group (pytest, pytest-asyncio, httpx)
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

## Contributing

We welcome contributions! Please follow the steps below:

1. Clone the repository and create a feature branch (`git checkout -b feature/your-feature-name`).
2. Make your modifications, ensuring you test the changes locally.
3. Commit your changes with descriptive messages.
4. Push your branch and submit a Pull Request.

## Author

- Delight Olu-Olagbuji ([LinkedIn](https://www.linkedin.com/in/delight-olu-olagbuji-990b61314))
# hsdtechnologies
