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

## 2026-08-22 — Final product identity

The product is **Review Workspace**. The final repository name is
`review-workspace`. The owner renamed the GitHub repository from
`Mvkd108/GenUI-Harness` to `Mvkd108/review-workspace` on 2026-08-22, and the
local `origin` remote now points there. The public npm scope is
`@review-workspace`. These names are frozen by the launch contract.

## 2026-08-22 — Semver with schema lockstep

All packages use semver and stay `0.x` during the beta; breaking changes bump
the minor version. `WORKSPACE_SCHEMA_VERSION`, the JSON Schema, the OpenAPI
document, and the schema/OpenAPI contract test change in the same commit.
`1.0.0` is the stable contract boundary, after which the public schema is
strict-semver protected.

## 2026-08-22 — Contract state vocabulary is authoritative

`LAUNCH_CONTRACT.md` defines four authoritative vocabularies: agent
(`working`, `stalled`, `idle`, `no signal`), work unit (`active`, `archived`,
`unavailable`), review (`needs attention`, `needs review`, `blocked`, `ready`,
`clean`), and checks (`missing`, `running`, `passed`, `failed`, `stale`). The
contract names are truth. The schema currently maps to some of them directly
(`AgentActivityState`, `GateRunStatus`) and conflicts on others:
`WorkUnitLifecycle`'s `ready-for-review` and `blocked` are review states, not
lifecycle states. Aligning the schema names with the contract vocabulary is a
follow-up, not part of the documentation freeze.

## 2026-08-22 — Worktrees are never deleted by the workspace

Archived and unregistered worktrees are never deleted, overwritten, or cleaned
by any code path. This generalizes the existing "never delete worktrees
implicitly" principle into a load-bearing contract constraint.

## 2026-08-22 — Performance targets are contract constraints

The launch contract freezes: a UI shell within two seconds; a useful workspace
within five seconds at approximately twenty work units; and no diff row
explosion, meaning a 500-file change never materializes hundreds of simultaneous
DOM rows (paged or virtualized diff rendering). A change that trades any of
these away without an owner decision is a contract violation.

## 2026-08-22 — Launch contract freezes exclusions

The beta explicitly excludes agent control, LAN access, phone access, Cursor
transcript reading, and generated UI. These are recorded in
`LAUNCH_CONTRACT.md` and must not be built without a new owner decision.

## 2026-08-22 — The queue is attention-first, with operator-owned views

The default queue view is Needs attention, derived from attention kinds that
demand the operator (merge-conflict, gate-failed, gate-stale, scope, risk,
unavailable, agent-stalled). Informational items (ready-for-review,
agent-working) never raise a unit into that view. Ready, In progress, All active,
and Archived are separate views with live counts. Every row shows one primary
state and one recommended next action. This keeps historical registrations out of
the daily queue without hiding them; the derivation lives in
`apps/web/src/features/workspace-queue/queueMeta.ts`.

## 2026-08-22 — Merge readiness is rendered as evidence, never as a score

The web app renders the contract's five check states (missing, running, passed,
failed, stale), the host's merge-readiness verdict, and concrete reasons. It never
renders internal numeric risk scores. The "Merge ready" label appears only from a
host readiness verdict of ready, which requires clean, conflict-free Git state and
every required trusted check current and passed. Repository-supplied proposals
are promoted but inert until the operator approves them; nothing suggested by a
branch ever executes automatically. The derivations live in
`apps/web/src/features/gates/gateStatus.ts`.

## 2026-08-22 — Archived work is a read surface, never a deletion path

Archived work units are excluded from the live snapshot. The web app reads them
from `GET /api/v1/work-units/archived`, which synthesizes lightweight views from
registrations with no Git inspection because archived worktrees are no longer
observed. Restore moves a unit back into active observation. Archive, restore,
and bulk archive go through the host endpoints; no code path deletes, checks out
over, or cleans an archived worktree.

## 2026-08-22 — M1: default storage is the OS application-data directory

Host-owned data defaults to the platform application-data directory
(`%LOCALAPPDATA%\review-workspace` on Windows, `~/Library/Application Support`
on macOS, `$XDG_DATA_HOME` or `~/.local/share` elsewhere). A relative
`--data-dir` resolves against `INIT_CWD` so the root pnpm start command lands in
the repository root, verified live. The default no longer sits beside the
working directory, so ordinary use cannot place host data inside a repository.

## 2026-08-22 — M1: SQLite schema versions with ordered migrations

The store tracks an explicit integer schema version with `PRAGMA user_version`
and applies ordered migrations in a transaction. Legacy 0.2.0 databases are
recognized by the missing `visibility` column and upgraded in place, preserving
registrations, gates, runs, and reviewed state. A database newer than the host
is refused rather than guessed at.

## 2026-08-22 — M1: host storage is refused inside an observed worktree

`isWithinPath` defines the boundary. Registration refuses a worktree that
contains the data directory, and opening a store refuses a data directory that
lives inside a registered worktree. A failed construction closes the database
handle before throwing, so a refusal cannot leak a locked SQLite file.

## 2026-08-22 — M1: visibility is persisted, lifecycle is derived

`WorkUnit.visibility` (`active`/`archived`) is operator-controlled and persisted;
refresh saves never overwrite it. `WorkUnit.lifecycle` is now only
`observing`/`unavailable`, derived from observability. Review state lives in
`mergeReadiness` and attention, never in lifecycle, which removes the
contradiction where a blocked work unit with changed files reported itself
`ready-for-review`.

## 2026-08-22 — M2: the HTTP server precedes reconciliation

The CLI starts the server before the first Git pass and reconciles in the
background, so the UI shell answers immediately instead of after the first
snapshot. A failed service start closes the server before rethrowing. The
transport stays full ordered `workspace.snapshot` events; partial progress is
published as complete snapshots, never as a new event type.

## 2026-08-22 — M2: snapshots are incremental and evidence-statused

Reconciliation inspects only the worktrees that changed, coalescing watcher
events by path with a debounce; no-op reconciliations do not advance the
sequence. Git inspection is bounded to four concurrent processes. The periodic
timer re-derives agent activity from cached inspections and polls degraded watch
paths instead of re-inspecting everything. Snapshots carry
`status` (`fresh`/`inspecting`/`stale`), `inspectedAt`, and `staleReason`; a
pending change, degraded watch, or failed inspection marks the snapshot stale so
readiness is never presented as current on stale evidence.

## 2026-08-22 — M5: review detail is per-file and paginated

Review detail is five tabs — Summary, Files, Diff, Checks, Activity — with a
fixed header and tab bar over an independently scrolling content region. Large
file lists paginate at one hundred rows and filter by reviewed status, file
status, directory, and risk surface, so a 500-file change never materializes
hundreds of DOM rows. The Diff tab shows one file at a time with previous/next
navigation and keeps the full unified diff as an explicit secondary view;
per-file diffs are fetched on demand from the cached inspection.

## 2026-08-22 — M5: reviewed markers are hash-bound to their patch

The store's `reviewed_files` rows record the content hash of the patch they
reviewed (database schema version 2). During inspection the host hashes each
changed file and reconciles the markers: a file whose content changed, or that
left the change set, has its review reset; legacy markers without a hash are
upgraded to the current hash so they stay valid until the patch actually
changes. The per-file diff endpoint serves only files in the change set and
never touches the filesystem with client input, so path traversal is
impossible and no Git operation mutates the repository.

## 2026-08-23 — M7: agent activity is advisory, legible, and path-free

- The public `AgentSession` no longer carries `sourcePath`. The host still needs
  the transcript path internally for discovery, caching, and binding, but the
  raw path is not part of the contract. This is a breaking schema change:
  `WORKSPACE_SCHEMA_VERSION` is now `0.4.0-beta.0` across the types, JSON
  Schema, OpenAPI document, and contract test.
- Message content and tool output were never copied into sessions and still are
  not; a regression test now locks that boundary and the exact public field set.
- The web UI renders all four states, including a distinct muted `no signal`
  pill instead of hiding the unknown state. `idle` is described as a turn that
  *ended*, never as finished or correct, and the panel carries a standing note
  that activity never affects merge readiness.
- Cursor stays explicitly unsupported: it writes no transcript files, so no
  guess is made about its activity.
- The three-minute stalled threshold is unchanged. It is not tuned until usage
  evidence justifies it; a boundary test locks the current behavior.

## 2026-08-23 — M8: integration, accessibility, security, and release hardening

- End-to-end coverage lives in `apps/host/src/integration.test.ts` (eleven HTTP
  scenarios against real Git repositories) and negative-security coverage in
  `apps/host/src/security.test.ts` (CORS, traversal, unapproved commands,
  transcript leakage, unsafe data locations, request cap). Both run inside
  `pnpm test`, so CI exercises them on Linux and Windows on every run.
- Accessibility is enforced two ways: axe scans across key fixtures (the
  color-contrast and layout-metric rules are disabled because jsdom cannot
  compute them), and keyboard-flow tests. The dialog now traps Tab, closes on
  Escape, and returns focus to the trigger.
- `WorkspaceService.stop()` awaits any in-flight reconciliation before closing
  the store. Found by the new suites: a background refresh could previously touch
  a closed database during shutdown.
- The host build uses `tsconfig.build.json` (excludes tests and test helpers)
  and wipes `dist` first; `copy-assets.mjs` clears the web bundle before copying.
  A packed tarball therefore contains only the CLI, its assets, and the schema
  documents. The smoke test pins this with `pnpm pack --dry-run`.
- The packed-install smoke runs the built CLI as the shipped artifact would be
  run. A true tarball-install smoke waits until the `@review-workspace` packages
  are published; the CLI/HTTP surface and pack shape are already covered.
