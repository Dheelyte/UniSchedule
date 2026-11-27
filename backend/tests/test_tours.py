"""Page previews are on for every account by default, remember the pages shown,
and can be turned off and back on (which starts afresh)."""
from modules.auth.models import RoleEnum

API = "/api/v1/tours"


async def test_previews_are_on_by_default_and_remember_pages(signed_in):
    client, _ = await signed_in(RoleEnum.FACULTY_VIEWER)
    assert (await client.get(API)).json() == {"enabled": True, "seen": []}

    for page in ("dashboard", "timetable-lectures", "dashboard"):
        response = await client.post(f"{API}/seen", json={"page": page})
        assert response.status_code == 200
    assert (await client.get(API)).json() == {"enabled": True, "seen": ["dashboard", "timetable-lectures"]}

    assert (await client.put(API, json={"enabled": False})).json()["enabled"] is False
    # Turning them back on plays every page's preview again.
    assert (await client.put(API, json={"enabled": True})).json() == {"enabled": True, "seen": []}


async def test_only_page_keys_are_stored_and_it_needs_a_login(signed_in, client):
    signed, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    for bad in ("", "Dashboard", "../x", "a" * 41, "has space"):
        assert (await signed.post(f"{API}/seen", json={"page": bad})).status_code == 422
    assert (await client.get(API)).status_code == 401


async def test_each_account_has_its_own(signed_in):
    first, _ = await signed_in(RoleEnum.FACULTY_EDITOR)
    second, _ = await signed_in(RoleEnum.DEO)
    await first.post(f"{API}/seen", json={"page": "courses"})
    await first.put(API, json={"enabled": False})
    assert (await second.get(API)).json() == {"enabled": True, "seen": []}
