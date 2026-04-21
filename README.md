# UniSchedule - University of Lagos Timetable Manager

UniSchedule is a comprehensive timetable management application for the University of Lagos. It features a Next.js 15 React frontend and a FastAPI (Python) backend to handle complex scheduling logic, access control, and PDF exports.

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
   *(Alternatively, configure a local PostgreSQL instance with credentials matching `core/config.py`)*

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
   DATABASE_URL=postgresql+asyncpg://postgres:password@localhost:5432/unilag_timetable
   SECRET_KEY=your_secret_key
   DEFAULT_SUPER_ADMIN_EMAIL=admin@email.com
   DEFAULT_SUPER_ADMIN_PASSWORD=adminpassword
   FRONTEND_URL=http://localhost:3000
   ```

5. Run database migrations:
   ```bash
   uv run alembic upgrade head
   ```

6. Start the FastAPI server:
   ```bash
   uv run uvicorn main:app --reload
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

## Contributing

We welcome contributions! Please follow the steps below:
1. Clone the repository and create a feature branch (`git checkout -b feature/your-feature-name`).
2. Make your modifications, ensuring you test the changes locally.
3. Commit your changes with descriptive messages.
4. Push your branch and submit a Pull Request.

Make sure to align your styles with our Indigo and Slate frontend design system, and keep all business logic tests updated in the backend.

## Deployment

- The frontend is optimized for deployment on [Vercel](https://vercel.com).
- The backend can be packaged using the included `Dockerfile` and deployed on AWS Lambda.
