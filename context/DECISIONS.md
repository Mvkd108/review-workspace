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

## 2026-08-18 — Built-in SQLite for the local proof

Use Node's built-in synchronous SQLite API for the local single-operator daemon.
Reconsider the driver only if the experimental API or write concurrency becomes
an operational problem; do not add a native dependency preemptively.
