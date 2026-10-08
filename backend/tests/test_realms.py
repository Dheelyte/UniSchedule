"""Realm config rules, the realms API, and per-realm course codes (ICE realm phase 1)."""
import copy
import importlib.util

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from core.database import async_session_maker
from modules.audit.models import ActivityLog
from modules.auth.models import CROSS_REALM_ROLES, RoleEnum
from modules.realms.defaults import ICE_CONFIG, SEED_REALMS, UG_CONFIG
from modules.realms.models import Realm
from modules.realms.schemas import RealmConfig
from modules.timetable.models import Course
from tests.conftest import BACKEND_DIR

API = "/api/v1"


def _config(**overrides) -> dict:
    return {**copy.deepcopy(UG_CONFIG), **overrides}


@pytest.fixture
async def restore_realms():
    """`realms` isn't truncated between tests, so put back whatever a test changes."""
    yield
    async with async_session_maker() as session:
        for seed in SEED_REALMS:
            realm = await session.get(Realm, seed["key"])
            for field, value in seed.items():
                setattr(realm, field, copy.deepcopy(value))
        await session.commit()


# --- RealmConfig -----------------------------------------------------------

@pytest.mark.parametrize("config", [UG_CONFIG, ICE_CONFIG])
def test_seed_configs_are_valid_and_unchanged_by_validation(config):
    assert RealmConfig.model_validate(config).model_dump() == config


def test_days_are_kept_in_week_order():
    config = RealmConfig.model_validate(_config(lecture_days=["Sunday", "Friday", "Saturday"]))
    assert config.lecture_days == ["Friday", "Saturday", "Sunday"]


@pytest.mark.parametrize("overrides", [
    pytest.param({"lecture_days": ["Monday", "Funday"]}, id="unknown weekday"),
    pytest.param({"exam_days": ["Mon"]}, id="abbreviated weekday"),
    pytest.param({"lecture_days": ["Monday", "Monday"]}, id="duplicate weekday"),
    pytest.param({"lecture_days": []}, id="no days"),
    pytest.param({"day_end": "08:00"}, id="day_end equals day_start"),
    pytest.param({"day_start": "19:00"}, id="day_end before day_start"),
    pytest.param({"day_start": "08:30"}, id="day_start not on the hour"),
    pytest.param({"day_start": "8am"}, id="day_start not HH:MM"),
    pytest.param({"slot_minutes": 7}, id="slot_minutes 7"),
    pytest.param({"exam_slots": []}, id="no exam slots"),
    pytest.param({"exam_slots": [
        {"label": "a", "start": "09:00", "end": "12:00"},
        {"label": "b", "start": "11:00", "end": "15:00"},
    ]}, id="exam slots overlap"),
    pytest.param({"exam_slots": [
        {"label": "a", "start": "09:00", "end": "12:00"},
        {"label": "b", "start": "13:00", "end": "15:00"},
    ]}, id="exam slots leave a gap"),
    pytest.param({"exam_slots": [
        {"label": "b", "start": "12:00", "end": "15:00"},
        {"label": "a", "start": "09:00", "end": "12:00"},
    ]}, id="exam slots unsorted"),
    pytest.param({"exam_slots": [{"label": "a", "start": "07:00", "end": "10:00"}]}, id="exam slot before day_start"),
    pytest.param({"exam_slots": [{"label": "a", "start": "16:00", "end": "19:00"}]}, id="exam slot after day_end"),
    pytest.param({"exam_slots": [{"label": "a", "start": "09:10", "end": "12:00"}]}, id="exam slot off the grid"),
    pytest.param({"exam_slots": [{"label": "a", "start": "12:00", "end": "12:00"}]}, id="empty exam slot"),
    pytest.param({"levels": []}, id="no levels"),
    pytest.param({"levels": [100, 100]}, id="duplicate levels"),
    pytest.param({"levels": [200, 100]}, id="levels not ascending"),
    pytest.param({"semester_names": []}, id="no semester names"),
    pytest.param({"semester_names": ["First Semester", "First Semester"]}, id="duplicate semester names"),
    pytest.param({"unexpected": 1}, id="unknown field"),
])
def test_realm_config_rejects(overrides):
    with pytest.raises(ValidationError):
        RealmConfig.model_validate(_config(**overrides))


def test_cross_realm_roles():
    assert CROSS_REALM_ROLES == {RoleEnum.SUPER_ADMIN, RoleEnum.SUPER_VIEWER, RoleEnum.CITS_ADMIN}


# --- Seed data -------------------------------------------------------------

def test_migration_seed_matches_defaults():
    """The revision keeps its own copy of the configs; it must not drift from the app's."""
    path = BACKEND_DIR / "migrations" / "versions" / "n4i5j6k7l8m9_add_realms.py"
    spec = importlib.util.spec_from_file_location("add_realms_revision", path)
    revision = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(revision)
    assert revision.UG_CONFIG == UG_CONFIG
    assert revision.ICE_CONFIG == ICE_CONFIG
    assert {role.value for role in CROSS_REALM_ROLES} == set(eval(revision.CROSS_REALM_ROLES))


async def test_get_realms_is_public_and_returns_the_seed(client):
    response = await client.get(f"{API}/realms")
    assert response.status_code == 200, response.text
    assert response.json() == SEED_REALMS
    by_key = {realm["key"]: realm for realm in response.json()}
    assert [key for key, realm in by_key.items() if realm["is_live"]] == ["UG"]
    assert by_key["PG"]["config"] == by_key["FOUNDATION"]["config"] == UG_CONFIG


# --- PUT /realms/{key} -----------------------------------------------------

async def test_update_realm_requires_super_admin(client, make_client, make_user, login, restore_realms):
    body = {"is_live": True}
    assert (await client.put(f"{API}/realms/ICE", json=body)).status_code == 401

    for role in (RoleEnum.FACULTY_EDITOR, RoleEnum.SUPER_VIEWER, RoleEnum.CITS_ADMIN):
        user = await make_user(role, faculty_id="ENG" if role == RoleEnum.FACULTY_EDITOR else None)
        other = make_client()
        await login(other, user["email"])
        assert (await other.put(f"{API}/realms/ICE", json=body)).status_code == 403

    async with async_session_maker() as session:
        assert (await session.get(Realm, "ICE")).is_live is False


async def test_super_admin_updates_realm(make_client, make_user, login, restore_realms):
    admin_user = await make_user(RoleEnum.SUPER_ADMIN)
    admin = make_client()
    await login(admin, admin_user["email"])

    new_config = {**copy.deepcopy(ICE_CONFIG), "day_end": "22:00", "lecture_days": ["Sunday", "Saturday"]}
    response = await admin.put(f"{API}/realms/ICE", json={"is_live": True, "config": new_config})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["is_live"] is True
    assert body["name"] == "ICE"  # untouched fields keep their value
    assert body["config"]["day_end"] == "22:00"
    assert body["config"]["lecture_days"] == ["Saturday", "Sunday"]

    listed = {realm["key"]: realm for realm in (await admin.get(f"{API}/realms")).json()}
    assert listed["ICE"] == body
    assert listed["UG"]["config"] == UG_CONFIG

    async with async_session_maker() as session:
        logs = (await session.execute(select(ActivityLog).where(ActivityLog.action == "realm.update"))).scalars().all()
    assert len(logs) == 1
    assert logs[0].entity_id == "ICE"
    assert logs[0].user_id == admin_user["id"]


async def test_update_realm_rejects_bad_input(make_client, make_user, login, restore_realms):
    admin_user = await make_user(RoleEnum.SUPER_ADMIN)
    admin = make_client()
    await login(admin, admin_user["email"])

    bad_config = {**copy.deepcopy(ICE_CONFIG), "slot_minutes": 7}
    assert (await admin.put(f"{API}/realms/ICE", json={"config": bad_config})).status_code == 422
    assert (await admin.put(f"{API}/realms/ICE", json={"key": "ICE2"})).status_code == 422
    assert (await admin.put(f"{API}/realms/NOPE", json={"is_live": True})).status_code == 404

    async with async_session_maker() as session:
        assert (await session.get(Realm, "ICE")).config == ICE_CONFIG


# --- Course codes ----------------------------------------------------------

async def test_course_code_is_unique_per_realm():
    async with async_session_maker() as session:
        legacy = Course(code="GST101", title="Use of English")  # no realm given: lands in UG
        session.add_all([legacy, Course(code="GST101", title="Use of English", realm_key="ICE")])
        await session.commit()
        await session.refresh(legacy)
        assert legacy.realm_key == "UG"

    async with async_session_maker() as session:
        session.add(Course(code="GST101", title="Duplicate", realm_key="ICE"))
        with pytest.raises(IntegrityError, match="uq_courses_realm_code"):
            await session.commit()
