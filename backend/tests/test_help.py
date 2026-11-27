"""The Help centre sends each role only its own part of the guide: hidden
pages, sections and lines never leave the server, and links to them become
plain text. Signed-in only."""
import re

import pytest

from modules.auth.models import RoleEnum
from modules.help import guide

API = "/api/v1/help"

# Features only a Super Admin can use: none of these may reach anyone else.
SUPER_ADMIN_ONLY_ANCHORS = {
    "tt-lock", "tt-import", "tt-copy", "tt-shift", "role-switcher", "impersonation", "faq-lock", "faq-holiday",
    "staff-edit-role", "staff-handovers", "act-export", "fac-add-faculty", "courses-faculty",
}
SUPER_ADMIN_ONLY_PAGES = {"terms", "timetable-import", "signoffs"}
SUPER_ADMIN_ONLY_PHRASES = ("View as", "viewing as another role", "Lock or unlock", "Academic Sessions", "Signatures & Stamps")


def everything_for(role: str) -> str:
    """The whole guide as this role receives it: menu, every page and the search index."""
    parts = [str(guide.nav(role)), str(guide.search_index(role))]
    for slug in guide.visible_pages(role):
        parts.append(guide.page_markdown(slug, role)["markdown"])
    return "\n".join(parts)


@pytest.mark.parametrize("role", ["DEO", "FACULTY_VIEWER", "HOD", "FACULTY_EDITOR", "GS_ADMIN", "CITS_ADMIN", "SUPER_VIEWER"])
def test_nobody_but_a_super_admin_receives_super_admin_material(role):
    text = everything_for(role)
    anchors = set(re.findall(r'id="([a-z0-9-]+)"', text)) | set(re.findall(r"#([a-z0-9-]+)", text))
    assert not anchors & SUPER_ADMIN_ONLY_ANCHORS, (role, anchors & SUPER_ADMIN_ONLY_ANCHORS)
    assert not set(guide.visible_pages(role)) & SUPER_ADMIN_ONLY_PAGES
    for phrase in SUPER_ADMIN_ONLY_PHRASES:
        assert phrase not in text, (role, phrase)
    # The markup itself never leaves the server.
    assert "data-roles" not in text and "<!-- roles" not in text and "page-roles" not in text


def test_a_super_admin_receives_everything():
    text = everything_for("SUPER_ADMIN")
    for anchor in SUPER_ADMIN_ONLY_ANCHORS:
        assert f'id="{anchor}"' in text, anchor
    assert SUPER_ADMIN_ONLY_PAGES <= set(guide.visible_pages("SUPER_ADMIN"))


def test_each_role_gets_its_own_questions():
    def questions(role):
        return set(re.findall(r'id="(faq-[a-z-]+)"', guide.page_markdown("faq", role)["markdown"]))

    assert {"faq-unlock", "faq-away"} <= questions("FACULTY_EDITOR")
    assert not {"faq-unlock", "faq-away", "faq-invite", "faq-cant-book"} & questions("DEO")
    assert {"faq-who-changed"} <= questions("SUPER_VIEWER")
    # The public questions are there for everyone signed in too.
    assert {"faq-account", "faq-printed"} <= questions("DEO")
    # Within a shared answer, only this role's lines.
    deo = guide.page_markdown("faq", "DEO")["markdown"]
    assert "Your role views only" in deo and "ask to edit" not in deo.lower()


def test_links_to_what_a_role_cant_see_become_plain_text():
    # The editor-access section links to Staff, which a DEO can't open.
    viewer = guide.page_markdown("timetable-exams", "DEO")["markdown"]
    assert "timetable-lectures.md#tt-lock" not in viewer and "Lock or unlock" not in viewer
    editor = guide.page_markdown("faq", "FACULTY_EDITOR")["markdown"]
    assert "](timetable-lectures.md#tt-request-edit)" in editor


def test_a_hidden_section_takes_its_sub_sections_with_it():
    viewer = guide.page_markdown("timetable-grid", "DEO")
    assert "grid-manage-conflicts" not in viewer["markdown"]
    assert "grid-jump-conflict" in viewer["markdown"]
    assert {s["id"] for s in viewer["sections"]} >= {"grid-faculty", "grid-event"}


def test_the_menu_only_lists_pages_the_role_can_open():
    pages = {p["slug"] for g in guide.nav("DEO") for p in g["pages"]}
    assert "dashboard" in pages and "faq" in pages
    assert not pages & (SUPER_ADMIN_ONLY_PAGES | {"activity", "requests", "staff", "timetable-cbt"})
    admin = {p["slug"] for g in guide.nav("SUPER_ADMIN") for p in g["pages"]}
    assert admin >= SUPER_ADMIN_ONLY_PAGES | {"activity", "requests", "staff"}
    assert all(p["summary"] for g in guide.nav("SUPER_ADMIN") for p in g["pages"])


async def test_the_endpoints_follow_the_signed_in_role(signed_in, client):
    deo, _ = await signed_in(RoleEnum.DEO)
    admin, _ = await signed_in(RoleEnum.SUPER_ADMIN)
    assert (await deo.get(f"{API}/pages/terms")).status_code == 404
    assert (await admin.get(f"{API}/pages/terms")).status_code == 200
    assert (await deo.get(f"{API}/pages/nope")).status_code == 404
    assert (await deo.get(f"{API}/pages/..%2Froles")).status_code == 404
    page = (await deo.get(f"{API}/pages/dashboard")).json()
    assert page["title"] == "Dashboard" and "role-switcher" not in page["markdown"]
    assert not any("/help/terms" in e["href"] for e in (await deo.get(f"{API}/search")).json())
    assert (await deo.get(f"{API}/nav")).status_code == 200
    # Signed out: nothing.
    for path in ("/nav", "/search", "/pages/dashboard", "/pages/faq"):
        assert (await client.get(f"{API}{path}")).status_code == 401
