# Product context

## Thesis

This is a coding-agent **review workspace** where review surfaces, rather than
the application shell, may eventually become generative. The immediate wedge is
absorbing agent output: what needs attention, why, and which branch is safe to
merge.

The fundamental unit is a work unit bound to a repository and worktree, not a
chat thread. Unmanaged work units make Claude Code, Cursor, Codex, and other
tools reviewable through Git and gates even when they cannot be controlled.

## Build gates

- Phase 0a: repo channel, trusted gates, deterministic ranking, desktop browser.
- Seven-day mixed-agent usage test.
- Two-day standalone AHP reducer feasibility spike.
- Phase 0b only after both gates pass: managed Codex sessions, phone control,
  approvals, steering, and cancellation.
- Declarative generated views only after the managed workflow proves useful.

## Durable principles

- Git CLI output is authoritative; do not substitute a JavaScript Git model.
- Gate definitions are host-owned and hash-pinned.
- Show risk reasons, never the internal numeric score.
- Never invent monetary cost estimates from token usage.
- Never delete worktrees implicitly.
- Keep stable navigation, diff, approval, and stop surfaces hand-built.

## Origin

The project originated from the gap between chat-shaped coding harnesses and a
malleable, higher-level workspace. Research found that dispatch is widely served
while verification, review throughput, merge safety, and interruption handling
remain the operator bottleneck.
