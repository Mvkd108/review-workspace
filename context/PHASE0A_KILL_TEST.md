# Phase 0a kill test

Start date: not started
End date: not started
Decision: pending

## Required exposure

- Seven consecutive days.
- At least ten real work units.
- At least three concurrently active worktrees.
- Include Codex, Claude Code, and Cursor work if they occur in the normal week.

## Daily log

For each day, record:

- Work units observed and which tools owned them.
- Whether the queue was checked before individual agent windows.
- Incorrect or unclear merge-readiness claims.
- Risk reasons that were valuable, missing, or false positives.
- Gate runs skipped correctly because nothing changed.
- Any time the terminal or another client was still the faster review surface.

## Pass criteria

- The queue becomes the first place checked when deciding what needs attention.
- Merge-readiness explanations agree with manual Git inspection.
- Risk reasons help prioritize review without exposing the numeric sort key.
- Trusted gate results remain current, stale, or failed exactly when expected.
- Mixed-agent unmanaged work remains useful without workflow migration.

If these do not hold, do not proceed to the AHP spike merely because the software
works technically.
