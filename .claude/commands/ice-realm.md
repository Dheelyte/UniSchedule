---
description: Build the ICE realm one phase at a time (docs/ice-realm/SPEC.md + PLAN.md)
argument-hint: "[phase-number]"
---

You're building the ICE (part-time) realm in UniSchedule. Do one phase per run.

## 1. Load context

Read these files in full:

- `docs/ice-realm/SPEC.md` is the design. Follow it. If the code contradicts it, or it's ambiguous about something that matters, stop and ask me instead of guessing.
- `docs/ice-realm/PLAN.md` holds the phases, checklists, follow-ups and progress log.
- `CLAUDE.md` and `AGENTS.md`. This is Next.js 16: read the relevant guide in `node_modules/next/dist/docs/` before any frontend change.

## 2. Pick the phase

- If I gave a phase number ("$ARGUMENTS"), run that phase.
- Otherwise run the first phase in PLAN.md that still has unchecked items.
- Check that the phase's prerequisites are ticked. If they aren't, tell me which ones and stop.
- Say in one line which phase you're starting.

## 3. Safety rules

- Work on the branch `feature/ice-realm`, creating it from `main` if it doesn't exist. **Never commit to or push `main`**: a push to main deploys to production and runs migrations on the production database.
- Only run Alembic or SQL against localhost databases. If `DATABASE_URL` points anywhere else, stop.
- Don't change UG behaviour. If you're not sure whether a change affects UG, first add a test that pins today's behaviour.
- Stay inside the phase. Add anything else to "Follow-ups" in PLAN.md.

## 4. Plan gate

If the phase is tagged [review-first], start by posting a short plan: the files you'll change, the migration or API shape, and the risks. Then wait until I reply "go". For other phases, go straight to the work.

## 5. Build and verify

1. Implement the phase's checklist.
2. Run every step under the phase's **Verify**.
3. Fix and re-run until everything passes.

Never tick an item that isn't both done and verified.

## 6. Record and stop

1. Tick the finished items in PLAN.md.
2. Append one line to PLAN.md's Progress log: `YYYY-MM-DD · Phase N · what changed · test results`.
3. Commit on `feature/ice-realm` with the message `ice-realm: phase N — <summary>`.
4. Stop and report:
   - what changed, by file;
   - test results;
   - anything left undone, and why;
   - the next phase.
5. Remind me to review the diff and run `/clear` before the next phase.
