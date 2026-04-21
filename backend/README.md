# UniSchedule Backend (FastAPI)

This is the Python REST API backing the UniSchedule Timetable Management Application.

## Technologies Used
- **FastAPI**: Pyton API framework
- **SQLAlchemy + asyncpg**: ORM and async PostgreSQL operations
- **Alembic**: Database migrations
- **Uvicorn**: ASGI web server
- **PyJWT & Passlib**: Authentication and password hashing

## Development
- Use `alembic revision --autogenerate -m "description"` to generate new migration versions when SQLAlchemy models change.
- Place new models or logic within their respective sub-packages located in `modules/`.
