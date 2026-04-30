import asyncio
import os
import sys
import uuid
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from alembic import context

# Make sure `core` and `modules` are importable regardless of CWD
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from core.base_model import Base
from core.config import settings

# Import all model modules so their tables register on Base.metadata
from modules.auth.models import User, Invitation, PasswordResetToken
from modules.calendar.models import AcademicSession, Semester
from modules.timetable.models import Faculty, Room, Course, ScheduleItem, BlockedSlot
from modules.notifications.models import Notification

DATABASE_URL = settings.DATABASE_URL

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", DATABASE_URL)

target_metadata = Base.metadata

print("TABLES SEEN BY ALEMBIC:", sorted(target_metadata.tables.keys()))


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = create_async_engine(
        DATABASE_URL,
        connect_args={
            "prepared_statement_name_func": lambda: f"__asyncpg_{uuid.uuid4()}__",
            "statement_cache_size": 0,
            "prepared_statement_cache_size": 0,
        },
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()