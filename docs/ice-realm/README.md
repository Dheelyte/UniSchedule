# ICE realm build kit for Claude Code

This kit adds ICE, the part-time programme, as a second realm next to Undergraduate. ICE has the same features, but its own calendar, courses and staff, and a Friday-to-Sunday timetable with flexible hours. Rooms stay shared with Undergraduate, and bookings are checked for clashes across both programmes.

## What's in the kit

| File | Purpose |
|---|---|
| `docs/ice-realm/SPEC.md` | The design: decisions, data model, rules, exact code locations and acceptance criteria |
| `docs/ice-realm/PLAN.md` | Eight phases with checklists, verification steps, and a progress log that Claude keeps up to date |
| `.claude/commands/ice-realm.md` | `/ice-realm` runs the next phase; `/ice-realm 3` runs a specific one |
| `.claude/commands/ice-audit.md` | `/ice-audit` runs a read-only check for data leaking between realms and for leftover hardcoded days and hours |
| `CLAUDE.md` | Adds the realm rules that every Claude Code session reads |

## Before you start

1. Copy the files into the repo root, keeping the paths above, and commit them.
2. Check "Confirm before Phase 1" in SPEC.md §2: ICE levels, semester names and exam slots. Change the values if ICE differs.
3. Make sure Docker and uv are installed. Claude Code runs the database and tests on your machine.

## Running it

1. Open Claude Code at the repo root and run `/ice-realm`. It starts with Phase 0: local setup and a test harness. It verifies the phase, ticks PLAN.md, commits to `feature/ice-realm` and stops.
2. Review the diff, run `/clear`, then run `/ice-realm` again for the next phase.
3. Phases 1, 2 and 4 (migration, login, room clashes) stop with a plan first. Reply "go" once you're happy with it.
4. Run `/ice-audit` whenever you want a second opinion, and always before Phase 7.

## Rules

- **Don't merge `feature/ice-realm` until Phase 7 is done.** Merging to `main` deploys to production and migrates the production database.
- **ICE stays hidden until launch.** It shows as "Coming soon" on `/realms` until a super admin sets it live. Before then, staff can still sign in at `/login?realm=ICE` to set it up.
