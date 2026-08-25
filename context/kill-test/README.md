# Kill-test log

This log records the Phase 0a/0b kill test. It follows `context/PHASE0A_KILL_TEST.md`.

## Required exposure (unchanged from the contract)

- Seven consecutive real-use days.
- At least ten real work units.
- At least three concurrently active worktrees.
- Codex, Claude Code, and Cursor work included if it occurs in the normal week.

## Status

- **Start date:** 2026-08-24 (first recorded day).
- **End date:** not reached.
- **Decision:** pending.
- **Days recorded:** 1 of 7.

## Anti-fabrication rule (binding)

Only observations made during real use may be written here, with the evidence
that produced them. A model may maintain this log, run the daemon, inspect
registered worktrees, and analyze failures — but it **must not fabricate usage
evidence**. Days 2–7 have no entries until a person actually uses the workspace
on those days and records what happened. Do not fill a day from a simulator,
from another day, or from assumption.

## How each day is recorded

One dated file under this directory, `YYYY-MM-DD.md`, with the fields from the
kill-test document: work units observed and their tools, whether the queue was
checked before individual agent windows, incorrect or unclear merge-readiness
claims, valuable/missing/false-positive risk reasons, gate runs skipped because
nothing changed, and any time another surface was faster than the workspace.

Issues found during a day are logged with a classification:

- **P0** — incorrect merge-ready, mutation, unapproved execution, data loss,
  transcript leakage.
- **P1** — core workflow unusable or misleading.
- **P2** — polish or low-frequency friction.

P0/P1 issues must be fixed in small dedicated PRs, and evidence collection is
restarted if readiness or ranking behavior materially changes.

## Day index

- [2026-08-24](2026-08-24.md) — day 1.
