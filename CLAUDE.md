@AGENTS.md

1. Timetable Logic & Conflicts
   Course Priorities: Add Priority 1 (University-wide courses) and Priority 2 (Interfaculty courses). Conflict detection should flag when a higher-priority course overlaps with a lower-priority one.
   Holiday Support: Implement a holiday system to block scheduling on protected dates.
   Multiple Exams in Venue: Relax conflict detection for exams, allowing multiple courses to share the same venue simultaneously.

## Realms (Undergraduate, ICE, …)

These rules describe the target design. `docs/ice-realm/PLAN.md` tracks how far the build has got; run `/ice-realm` to continue it. Full design: `docs/ice-realm/SPEC.md`.

- **What a realm is.** A programme with its own calendar, courses, timetables and staff: UG (undergraduate) and ICE (part-time). PG and FOUNDATION are seeded but not live.
- **Realm-scoped data:**
  - academic sessions, and the semesters, schedule items, blocked slots, locks and change requests under them;
  - courses and their enrollments;
  - conflict dismissals;
  - audit logs;
  - users in realm-bound roles.
- **Shared data:** faculties, departments and rooms.
- **Query scoping.** Every query on realm-scoped data filters by the caller's realm (`current_user["realm"]`).
  - Repository list methods take a required `realm_key`.
  - An id from another realm is treated as not found (404).
- **Roles.** SUPER_ADMIN, SUPER_VIEWER and CITS_ADMIN are cross-realm: they choose a realm at login and can switch. Every other role belongs to exactly one realm. This is unrelated to `_has_global_scope` / `hasGlobalScope`, which are about faculties.
- **No hardcoded calendar values.** Days, hours, time steps, levels and semester names come from the realm config (`backend/modules/realms`, `src/lib/realm.js`). That applies to the UI, the conflict checks and the exports.
- **Shared rooms.** Rooms are physical and shared. Two same-type sessions from different realms can't overlap in a room; the API returns 409.
- **Migrations and deploys.** Migrations must stay additive and safe for the previous version of the code; use server defaults. The deploy workflow runs `alembic upgrade head` on production before the new Lambda is live. Pushing to `main` deploys to production.
