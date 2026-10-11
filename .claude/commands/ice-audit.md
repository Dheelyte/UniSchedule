---
description: Read-only audit for realm data leaks and leftover hardcoded UG timetable assumptions
---

Audit UniSchedule against `docs/ice-realm/SPEC.md`. This is read-only: don't change any code. Run step 1 (the realm-leak review) in a subagent, so the code is read with fresh eyes.

## 1. Realm leaks (backend)

- **Queries.** Check every SQLAlchemy query in `backend/modules/**/repository.py` and `backend/modules/**/service.py` that touches realm-scoped data (SPEC §5 and §7). Each must filter by the active realm, or by an id that has already been checked to belong to it.
- **Routes.** For every route in `backend/api/v1/`, check that the caller's realm reaches the query.

Report each gap with file:line.

## 2. Cross-realm rules (backend)

- **Room clashes.** Creating a schedule item, updating one, and approving a change request must all run the cross-realm room-clash check (SPEC §8.2).
- **Strict window.** For strict realms, those same paths must run the window validation (SPEC §8.1).

## 3. Hardcoded week (frontend)

Search `src/` for:

- weekday names;
- `'08:00'`, `'18:00'`, `18 * 60`, `h <= 18`, `h - 8`, `repeat(20`;
- level arrays such as `[100, 200`;
- `'First Semester'`.

List every hit that doesn't go through `src/lib/realm.js` or the realm config. The UG defaults inside `src/lib/realm.js` itself are fine.

## 4. Checks

Run:

- `cd backend && uv run pytest -q`
- `npm test`
- `npm run lint`
- `npm run build`

## Report

Give a table with these columns: severity (blocker, should-fix or nit), file:line, finding, suggested fix.

Then add the blockers and should-fixes to "Follow-ups" in `docs/ice-realm/PLAN.md`. That is the only file you may edit.
