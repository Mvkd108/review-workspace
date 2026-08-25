# Session handoff — 2026-08-24 (kill test, day 1)

## Outcome

Started the seven-day kill test against real evidence. Day 1 is recorded in
`context/kill-test/2026-08-24.md`. Nineteen real worktrees are registered and
observed by a running daemon; every readiness, risk, and agent-state claim made
in the day's log was cross-checked against manual Git inspection or the
transcript files. No P0 or P1 issue was found. Three P2 items were logged.

The test is at 1 of 7 days. The remaining six days cannot be produced by a model
and are explicitly unrecorded; they require real operator usage each day. This
is a hard rule recorded in `kill-test/README.md`.

## What was done

- Started the daemon (`node apps/host/dist/cli.js --port 4317`) with the default
  data directory. It is still running as PID 47116; stop with
  `Stop-Process -Id 47116`.
- Registered 19 real work units (muesli base + eleven agent worktrees,
  cloud-agents, COMPUSEAGENT_NATIVE, DevIQ-main, habit-garden, rekall,
  review-workspace, stock-signal-scraper) with their known tool labels.
  Re-registered once after an input artifact (three `master`-only repos were
  first given an explicit `baseRef: main`, producing "base reference does not
  resolve"; auto-detected base refs fixed it). Registration is read-only.
- Verified against manual Git:
  - `blocked` dirty-worktree claims matched `git status --porcelain` counts
    (52/70/26/19/25).
  - `blocked` + `merge-conflict` on `agent-a-l10-l11-inventory` matched
    `git merge-tree --write-tree origin/main HEAD` exiting 1.
  - `unknown` on habit-garden/stock-signal-scraper matched clean branches with
    no commits ahead of `master`.
  - `stalled`/`working`/`idle` agent states matched the transcript tails'
    structural markers and cwds; `unknown` on agent branches matched no
    transcript within the 24-hour discovery window.
- Observed the host survive the known EPERM pytest-cache directories under
  COMPUSEAGENT_NATIVE (degraded to polling, no crash).
- Wrote `context/kill-test/README.md` (index + anti-fabrication rule),
  `context/kill-test/2026-08-24.md` (day 1), updated
  `PHASE0A_KILL_TEST.md` (start date), `CURRENT.md`, and `NEXT.md`.

## P2 items logged (no P0/P1)

1. Explicit non-existent base ref yields "base reference does not resolve"
   (registration input; auto-detect avoids it — consider a form hint).
2. Sibling agent branches tie on identical risk reasons/scores; recency breaks
   ties. Reasons are real, not false positives.
3. `unknown` agent state on worktrees whose transcripts are older than the
   24-hour window; correct by design but worth a gentler hint later.

## Checks run

- Workspace API: `status=fresh`, `seq` advancing, 19 units.
- Manual git cross-checks above.
- No context-check impact (docs only); `pnpm context:check:strict` still passes.

## Exact continuation point

Days 2–7 of the kill test: use the queue as the first review surface each day,
record the daily log entry from real usage (including approving a real gate to
exercise the checks pass criteria, which were untested on day 1), and continue
triage. The daemon is running and the registrations persist in
`%LOCALAPPDATA%\review-workspace`. Do not fabricate days. If a P0/P1 appears,
fix it in a small dedicated PR and restart evidence collection if readiness or
ranking behavior changes. The M7/M8/trusted-checks work remains uncommitted in
the working tree.
