"""The guard that keeps the suite's deletes away from real databases."""
import pytest

from core.database import engine
from tests import conftest
from tests.db_guard import UnsafeDatabaseError, assert_disposable_database

DRIVER = "postgresql+asyncpg://postgres:password@"


@pytest.mark.parametrize("url", [
    f"{DRIVER}localhost:5433/unilag_timetable_test",
    f"{DRIVER}127.0.0.1:5432/unilag_timetable_test",
    f"{DRIVER}localhost:5433/unilag_timetable_migration_test",
])
def test_local_test_databases_are_disposable(url):
    assert assert_disposable_database(url).database.endswith("_test")


@pytest.mark.parametrize("url", [
    # The local development database: local, but not a test database.
    f"{DRIVER}localhost:5433/unilag_timetable",
    f"{DRIVER}localhost:5433/unilag_timetable_test_copy",
    f"{DRIVER}localhost:5433/postgres",
    # A test-named database somewhere else.
    f"{DRIVER}db.example.com:5432/unilag_timetable_test",
    f"{DRIVER}10.0.0.5:5432/unilag_timetable_test",
    # No host or no database at all.
    "postgresql+asyncpg:///unilag_timetable_test",
    f"{DRIVER}localhost:5433/",
], ids=["dev", "suffix-in-the-middle", "postgres", "remote", "private-ip", "no-host", "no-database"])
def test_everything_else_is_refused(url):
    with pytest.raises(UnsafeDatabaseError, match="Refusing to delete data"):
        assert_disposable_database(url)


def test_the_suite_checks_the_database_the_engine_really_uses():
    # Whatever TEST_DATABASE_URL says, the deletes go through this engine.
    assert assert_disposable_database(engine.url).database == conftest._url.database


async def test_cleaning_refuses_an_engine_pointed_elsewhere(monkeypatch):
    """What went wrong once: settings were loaded before conftest set the test
    database, so the engine pointed at the development database."""

    class DevEngine:
        url = conftest._url.set(database="unilag_timetable")

        def begin(self):
            raise AssertionError("the guard must refuse before any connection is opened")

    monkeypatch.setattr(conftest, "engine", DevEngine())
    with pytest.raises(UnsafeDatabaseError, match="unilag_timetable"):
        await conftest.clean_tables()
