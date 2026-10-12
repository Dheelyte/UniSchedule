"""ICE lectures can be on any day of the week

Revision ID: p6k7l8m9n0o1
Revises: o5j6k7l8m9n0
Create Date: 2026-10-12 00:00:00.000000

Data only, and only ICE's `lecture_days`: some ICE departments teach Monday to
Thursday. Its exam days, day window, time step and exam slots are not touched,
and neither is any other realm or any realm's `is_live`.

Safe for the previous version of the code, which the deploy workflow leaves
running while this is applied: the config gains no key (that code rejects
unknown ones), only a longer list of days it already understands.
"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'p6k7l8m9n0o1'
down_revision: Union[str, Sequence[str], None] = 'o5j6k7l8m9n0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Kept as literals on purpose (a migration must not import app code).
# tests/test_realms.py checks they match modules/realms/defaults.py.
ICE_LECTURE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
PREVIOUS_ICE_LECTURE_DAYS = ["Friday", "Saturday", "Sunday"]


def _set_ice_lecture_days(days: list[str]) -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE realms SET config = jsonb_set(config, '{lecture_days}', CAST(:days AS jsonb)) WHERE key = 'ICE'"
        ),
        {"days": json.dumps(days)},
    )


def upgrade() -> None:
    """Upgrade schema."""
    _set_ice_lecture_days(ICE_LECTURE_DAYS)


def downgrade() -> None:
    """Downgrade schema.

    ICE lectures already scheduled on Monday to Thursday stay where they are;
    under the old list they can no longer be edited without moving them.
    """
    _set_ice_lecture_days(PREVIOUS_ICE_LECTURE_DAYS)
