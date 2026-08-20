# Decisions

## 2026-08-17 — TypeScript end to end

Use TypeScript for the host, web app, schema, and adapters. The later ACP/AHP
ecosystem is TypeScript-native and shared types avoid serialization duplication.

## 2026-08-17 — Repo channel before agent channel

Validate review behavior using worktrees and gates before implementing an AHP
host or ACP bridge. Unmanaged work units are permanent, not a temporary fixture.

## 2026-08-17 — Native Git is authoritative

Shell out directly to the Git executable with `shell: false`. Do not use
isomorphic-git or nodegit for merge-readiness claims.

## 2026-08-17 — Host-owned gate trust

Gate definitions live outside observed worktrees. A repo proposal must be
approved and hash-pinned before it can become authoritative.

## 2026-08-17 — Apache-2.0 and public schema

License the application, schema, SDK, and adapters under Apache-2.0. Keep the
workspace schema independent from ACP/AHP and publish it as the integration
artifact.

## 2026-08-18 — Ordered SSE for the repo channel

Phase 0a publishes full, ordered workspace snapshots over server-sent events.
No-op reconciliation does not advance the sequence. The Phase 0b event transport
may change without altering the public workspace types.

## 2026-08-18 — Repository gates are proposals only

`.review-workspace-gates.json` may suggest structured gate definitions. The host
normalizes and hashes them but never executes them until explicit approval copies
the exact definition into host-owned SQLite.

## 2026-08-20 — Phase 0b started early by owner decision

The plan gated Phase 0b behind a passing seven-day kill test and an AHP reducer
spike. The owner chose to start the agent channel immediately instead, because
the repo channel cannot answer whether an agent is still working, and that gap
was blocking real use. Both gates are therefore unmet and remain unmet: the kill
test has no recorded days and the AHP spike has not run.

Record this rather than rewrite the plan. If the agent channel proves the wrong
shape, the missing evidence is the reason, not a surprise.

## 2026-08-20 — Observe agent transcripts, do not control agents

The agent channel reads agent-owned transcript files and nothing else. It does
not launch, steer, cancel, or hold a session. Codex writes `session_meta` with a
`cwd` and brackets turns with `task_started` and `task_complete`; Claude Code
records `cwd` per entry and ends a turn with an assistant `stop_reason` of
`end_turn`. Both are read from the file tail, so cost does not grow with
transcript length.

This keeps Git authoritative. A transcript reports what an agent believes it is
doing; only Git says what changed. Activity never feeds merge readiness.

Cursor is deliberately unsupported: it stores chat in a VS Code SQLite database
rather than transcript files. An empty agent panel says so instead of implying
the agent is idle.

## 2026-08-20 — A single unreadable path must not stop the host

Registering a worktree containing a permission-locked directory killed the whole
daemon: chokidar emitted an `error` event for an `EPERM` on `realpath`, and an
unhandled `error` event is fatal in Node. The watcher now handles the event,
reports each distinct failure once, and leaves that path to interval polling.
Git inspection still covers it, so the work unit degrades rather than
disappearing.

## 2026-08-18 — Built-in SQLite for the local proof

Use Node's built-in synchronous SQLite API for the local single-operator daemon.
Reconsider the driver only if the experimental API or write concurrency becomes
an operational problem; do not add a native dependency preemptively.
