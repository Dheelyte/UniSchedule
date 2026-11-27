"""The user guide (backend/guide/*.md), filtered for the reader's role.

The Help centre (/help) shows only what the signed-in person's role can use:
pages, sections and lines for other roles are removed here, so they never
reach the browser. Nothing is loaded until the Help centre is first opened.

Markup in the guide files (see guide/README.md):

- ``<!-- page-roles: SUPER_ADMIN, SUPER_VIEWER -->`` on a page's first line:
  only those roles see the page at all.
- ``<a id="name" data-roles="SUPER_ADMIN"></a>`` before a heading: only those
  roles see that section, including everything under it (its sub-sections).
- ``<!-- roles: SUPER_ADMIN -->`` … ``<!-- /roles -->`` around lines inside a
  section (list items, table rows, sentences): only those roles see them.
- ``public`` in a list means everyone, including the public FAQ (/faq).

Anything without a list is for every signed-in role. Links to a page or section
the reader can't see are turned into plain text.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

GUIDE_DIR = Path(__file__).resolve().parents[2] / "guide"
INDEX = "README"
# Sections of the index that are notes for whoever maintains the guide.
MAINTAINERS_ONLY = ("Keeping this guide up to date",)

PAGE_ROLES = re.compile(r"^<!--\s*page-roles:\s*([^>]*?)\s*-->\s*$")
BLOCK_START = re.compile(r"^<!--\s*roles:\s*([^>]*?)\s*-->\s*$")
BLOCK_END = re.compile(r"^<!--\s*/roles\s*-->\s*$")
ANCHOR = re.compile(r'^<a id="([a-z0-9-]+)"(?:\s+data-roles="([^"]*)")?\s*></a>\s*$')
HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")


def _roles(text: str | None) -> frozenset[str] | None:
    if text is None:
        return None
    return frozenset(r.strip() for r in text.split(",") if r.strip())


def _allowed(roles: frozenset[str] | None, role: str) -> bool:
    return roles is None or "public" in roles or role in roles


@dataclass(frozen=True)
class Unit:
    """A heading and what follows it, up to the next heading."""
    level: int  # 0 for the text before the first heading
    title: str
    anchors: tuple[str, ...]
    roles: frozenset[str] | None
    lines: tuple[str, ...]


@dataclass(frozen=True)
class Page:
    slug: str
    title: str
    roles: frozenset[str] | None
    units: tuple[Unit, ...]


def _parse(slug: str, text: str) -> Page:
    lines = text.split("\n")
    roles = None
    if lines and (m := PAGE_ROLES.match(lines[0])):
        roles = _roles(m.group(1))
        lines = lines[1:]
    units: list[Unit] = []
    current = {"level": 0, "title": "", "anchors": [], "roles": None, "lines": []}
    pending_anchors: list[tuple[str, frozenset[str] | None, str]] = []

    def close():
        units.append(Unit(current["level"], current["title"], tuple(current["anchors"]), current["roles"], tuple(current["lines"])))

    for line in lines:
        if m := ANCHOR.match(line):
            pending_anchors.append((m.group(1), _roles(m.group(2)), line))
            continue
        if pending_anchors and not line.strip():
            continue  # a blank line between an anchor and its heading
        if m := HEADING.match(line):
            close()
            tagged = [r for _, r, _ in pending_anchors if r is not None]
            current = {
                "level": len(m.group(1)),
                "title": m.group(2),
                "anchors": [a for a, _, _ in pending_anchors],
                "roles": tagged[0] if tagged else None,
                "lines": [f'<a id="{a}"></a>' for a, _, _ in pending_anchors] + [line],
            }
            pending_anchors = []
            continue
        # Anchors not followed by a heading stay where they are.
        for a, _, _ in pending_anchors:
            current["lines"].append(f'<a id="{a}"></a>')
        pending_anchors = []
        current["lines"].append(line)
    close()
    title = next((u.title for u in units if u.level == 1), slug)
    return Page(slug, title, roles, tuple(units))


@lru_cache(maxsize=1)
def _pages() -> dict[str, Page]:
    """Every guide file, parsed once, on first use."""
    return {p.stem: _parse(p.stem, p.read_text(encoding="utf-8")) for p in sorted(GUIDE_DIR.glob("*.md"))}


def _visible_units(page: Page, role: str) -> list[Unit]:
    """The units this role sees: a hidden section takes its sub-sections with it."""
    shown: list[Unit] = []
    hidden_below: int | None = None  # the level of the hidden section we're inside
    for unit in page.units:
        if hidden_below is not None and unit.level > hidden_below:
            continue
        hidden_below = None
        if not _allowed(unit.roles, role):
            hidden_below = unit.level if unit.level else 0
            continue
        shown.append(unit)
    return shown


def _filter_lines(lines: tuple[str, ...], role: str) -> list[str]:
    out: list[str] = []
    block: frozenset[str] | None = None
    in_block = False
    for line in lines:
        if m := BLOCK_START.match(line):
            in_block, block = True, _roles(m.group(1))
            continue
        if BLOCK_END.match(line):
            in_block, block = False, None
            continue
        if in_block and not _allowed(block, role):
            continue
        out.append(line)
    return out


def visible_pages(role: str) -> dict[str, Page]:
    return {slug: p for slug, p in _pages().items() if slug != INDEX and _allowed(p.roles, role)}


@lru_cache(maxsize=32)
def _anchors_for(role: str) -> dict[str, frozenset[str]]:
    """The section anchors each visible page has for this role."""
    return {
        slug: frozenset(a for u in _visible_units(page, role) for a in u.anchors)
        for slug, page in visible_pages(role).items()
    }


def _link_target_visible(target: str, from_slug: str, role: str) -> bool:
    if re.match(r"^[a-z]+:", target, re.I) or target.startswith("/"):
        return True
    file, _, anchor = target.partition("#")
    slug = file[:-3] if file.endswith(".md") else (file or from_slug)
    if slug == INDEX:
        return True
    anchors = _anchors_for(role).get(slug)
    if anchors is None:
        return False
    return not anchor or anchor in anchors


def _unlink_hidden(text: str, from_slug: str, role: str) -> str:
    return LINK.sub(lambda m: m.group(0) if _link_target_visible(m.group(2), from_slug, role) else m.group(1), text)


def page_markdown(slug: str, role: str) -> dict | None:
    """A page as this role sees it: {slug, title, markdown, sections}, or None if hidden or missing."""
    page = visible_pages(role).get(slug)
    if page is None:
        return None
    units = _visible_units(page, role)
    body = "\n".join(line for u in units for line in _filter_lines(u.lines, role))
    sections = [{"id": u.anchors[0], "title": u.title} for u in units if u.anchors and u.level >= 2]
    return {"slug": slug, "title": page.title, "markdown": _unlink_hidden(body, slug, role).strip() + "\n", "sections": sections}


def nav(role: str) -> list[dict]:
    """The Help centre menu: the index's groups and the pages this role can see, with a line about each."""
    index = _pages()[INDEX]
    pages = visible_pages(role)
    groups: list[dict] = []
    for unit in index.units:
        if unit.level != 2 or unit.title in MAINTAINERS_ONLY:
            continue
        entries = []
        for line in unit.lines:
            for m in LINK.finditer(line):
                slug = m.group(2)[:-3] if m.group(2).endswith(".md") else None
                if not slug or slug not in pages or any(e["slug"] == slug for e in entries):
                    continue
                rest = line[m.end():]
                summary = re.sub(r"^[\s:|]+", "", rest).split("|")[0].strip()
                entries.append({"slug": slug, "title": m.group(1), "summary": summary})
        if entries:
            groups.append({"title": unit.title, "pages": entries})
    return groups


def _plain(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = LINK.sub(lambda m: m.group(1), text)
    text = re.sub(r"[`*_|#>]", " ", text)
    text = re.sub(r"-{3,}", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def search_index(role: str) -> list[dict]:
    """What search looks through: each visible page and section, with its text."""
    entries = []
    for slug in visible_pages(role):
        shown = page_markdown(slug, role)
        page = visible_pages(role)[slug]
        base = f"/help/{slug}"
        entries.append({"href": base, "page": shown["title"], "title": shown["title"], "text": ""})
        for unit in _visible_units(page, role):
            if not unit.anchors or unit.level < 2:
                continue
            body = "\n".join(_filter_lines(unit.lines[1 + len(unit.anchors):], role))
            entries.append({"href": f"{base}#{unit.anchors[0]}", "page": shown["title"], "title": unit.title, "text": _plain(body)[:400]})
    return entries
