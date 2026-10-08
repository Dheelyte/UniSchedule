import asyncio
import os
import uuid
from pathlib import Path

# The app reads its settings at import time, so the environment is set first.
# TEST_DATABASE_URL lets CI point at its own Postgres service.
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:password@localhost:5433/unilag_timetable_test",
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("SECRET_KEY", "test-secret-key-test-secret-key-test-secret-key")
os.environ["ENVIRONMENT"] = "dev"
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["DB_NULL_POOL"] = "true"

import asyncpg  # noqa: E402
import bcrypt  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from core.database import async_session_maker, engine  # noqa: E402
from main import app  # noqa: E402
from modules.auth.models import CROSS_REALM_ROLES, RoleEnum, User, stored_realm_key  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_PASSWORD = "Password123"
# Tables that keep their rows between tests (`realms` is seeded by a migration).
KEEP_TABLES = ("alembic_version", "realms")

_url = make_url(TEST_DATABASE_URL)
# Every test truncates the database, so refuse anything that isn't a local test database.
if _url.host not in ("localhost", "127.0.0.1") or not (_url.database or "").endswith("_test"):
    raise RuntimeError(
        f"Refusing to run tests against {_url.host}/{_url.database}: "
        "the test database must be on localhost and its name must end with '_test'."
    )


async def _create_database_if_missing() -> None:
    conn = await asyncpg.connect(
        host=_url.host,
        port=_url.port or 5432,
        user=_url.username,
        password=_url.password,
        database="postgres",
    )
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", _url.database)
        if not exists:
            await conn.execute(f'CREATE DATABASE "{_url.database}"')
    finally:
        await conn.close()


@pytest.fixture(scope="session", autouse=True)
def _migrated_database():
    # Sync on purpose: Alembic's env.py calls asyncio.run() itself.
    asyncio.run(_create_database_if_missing())
    command.upgrade(Config(str(BACKEND_DIR / "alembic.ini")), "head")


@pytest.fixture(autouse=True)
async def _clean_tables(_migrated_database):
    async with engine.begin() as conn:
        result = await conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> ALL(:keep)"),
            {"keep": list(KEEP_TABLES)},
        )
        tables = [row[0] for row in result]
        if tables:
            quoted = ", ".join(f'"{t}"' for t in tables)
            await conn.execute(text(f"TRUNCATE {quoted} RESTART IDENTITY CASCADE"))


@pytest.fixture
async def make_client():
    """Factory for API clients. Each client has its own cookie jar, so each can be a different user."""
    clients: list[AsyncClient] = []

    def _make() -> AsyncClient:
        client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
        clients.append(client)
        return client

    yield _make
    for client in clients:
        await client.aclose()


@pytest.fixture
async def client(make_client) -> AsyncClient:
    return make_client()


@pytest.fixture
def make_user():
    """Insert a user directly and return {"id", "email", "password", "role", "faculty_id", "realm_key"}.

    `realm` applies to realm-bound roles; cross-realm roles are stored with no realm.
    """

    async def _make(
        role: RoleEnum | str, faculty_id: str | None = None, email: str | None = None, realm: str = "UG"
    ) -> dict:
        role = RoleEnum(role)
        realm_key = None if role in CROSS_REALM_ROLES else realm
        email = email or f"{role.value.lower()}-{uuid.uuid4().hex[:8]}@example.com"
        # Low cost factor keeps the suite fast; verify_password accepts any cost.
        hashed = bcrypt.hashpw(DEFAULT_PASSWORD.encode(), bcrypt.gensalt(rounds=4)).decode()
        async with async_session_maker() as session:
            user = User(
                email=email, hashed_password=hashed, role=role, faculty_id=faculty_id,
                realm_key=stored_realm_key(role, realm), is_active=True,
            )
            session.add(user)
            await session.commit()
            return {
                "id": user.id,
                "email": email,
                "password": DEFAULT_PASSWORD,
                "role": role.value,
                "faculty_id": faculty_id,
                "realm_key": realm_key,
            }

    return _make


@pytest.fixture
def login():
    """Sign `client` in; the session cookie stays on the client.

    `realm` is the portal to sign in to; leave it out to sign in the way the pre-realm frontend does.
    """

    async def _login(client: AsyncClient, email: str, password: str = DEFAULT_PASSWORD, realm: str | None = None):
        body = {"email": email, "password": password}
        if realm is not None:
            body["realm"] = realm
        response = await client.post("/api/v1/auth/login", json=body)
        assert response.status_code == 200, response.text
        return response

    return _login
