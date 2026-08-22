# Current state

Last updated: 2026-08-22

The architecture is frozen by `LAUNCH_CONTRACT.md`, which defines the product
identity, the four authoritative state vocabularies, the worktree-preservation
rule, the performance targets, the exclusions, and the beta completion and
failure criteria. The schema now matches the contract's work-unit vocabulary:
`visibility` (`active`/`archived`) is persisted and operator-controlled, while
`lifecycle` (`observing`/`unavailable`) is derived observability. Review state
lives in `mergeReadiness` and attention, never in lifecycle.

Phase 0a is implemented as a usable local review workspace. The canonical
repository is published on `main` at
`https://github.com/Mvkd108/review-workspace`; the initial source checkpoint is
commit `bebd094`. The repository was renamed from `GenUI-Harness` to
`review-workspace` on 2026-08-22, and the local `origin` remote tracks it.

The first Phase 0b slice, the read-only agent channel, is also implemented. It
was started before its two gates were met, by owner decision recorded in
`DECISIONS.md`. The seven-day kill test still has no recorded days and the AHP
reducer spike has not run.

## Working behavior

- Apache-2.0 pnpm/TypeScript workspace with public schema, adapter API, Node
  daemon/CLI, React desktop application, OpenAPI document, and JSON Schema.
- Unmanaged worktree registration for Codex, Claude Code, Cursor, or other tools.
- Native Git inspection for branch/base identity, dirty state, committed and
  untracked changes, ahead/behind counts, diffs, fingerprints, and non-mutating
  merge-tree conflict checks.
- Deterministic reason-first risk ranking. The internal numeric score is never
  rendered by the web application.
- Host-owned SQLite gate definitions, structured `shell: false` execution,
  environment allowlisting, output limits, timeouts, definition hashing, exact
  diff fingerprint binding, stale-result detection, and unchanged-result reuse.
- `.review-workspace-gates.json` is read only as a hash-stamped proposal. A user
  must explicitly approve it before the host persists or executes the gate.
- Ranked queue, evidence panels, unified diff, reviewed-file tracking, trusted
  gate management and logs, ordered SSE snapshots, and watched reconciliation.
- The HTTP server starts before the first Git pass, so the shell is available
  almost immediately; reconciliation runs in the background and publishes
  ordered partial snapshots as each work unit completes.
- Filesystem changes reinspect only the affected worktree, coalesced and
  debounced by path. Git inspection is bounded to four concurrent processes.
  Agent activity re-derives on a periodic timer from cached Git evidence, so
  `working` decays to `stalled` without reinspecting every worktree.
- Snapshots expose `status` (`fresh`/`inspecting`/`stale`) plus `inspectedAt`
  and `staleReason`. A change awaiting reinspection, a degraded watch path, or
  a failed inspection marks the workspace `stale` so readiness is never
  presented as current on stale evidence. Degraded watch paths fall back to
  periodic Git polling.
- Review detail has five tabs — Summary, Files, Diff, Checks, Activity — with a
  fixed header and tab bar while the content region scrolls independently.
- The Files tab paginates large change sets (100 per page) and filters by
  reviewed status, file status, directory, and risk surface. The Diff tab shows
  one file at a time with previous/next navigation and an explicit Unified diff
  secondary view; per-file diffs are loaded on demand through
  `GET /work-units/{id}/diff?file=<path>`, which refuses anything outside the
  change set, so traversal is impossible and no Git operation mutates the repo.
- A reviewed marker is valid only while the patch it reviewed is unchanged: the
  host hashes each changed file during inspection and resets the marker when the
  content changes or the file leaves the change set.
- The web app is decomposed into feature directories under `apps/web/src/features`
  (workspace-queue, review, gates, activity, registration) with shared components
  under `components/`, a fixture registry under `fixtures/`, and styles split
  into tokens, layout, shared components, and per-feature stylesheets. `App.tsx`
  is primarily composition and data connection; the api is injectable through
  `ApiContext` so fixtures and tests substitute a stub.
- A fixture-driven development page (`?harness` URL) serves contract-state
  snapshots through an in-memory api, code-split out of the main bundle.
- React component tests run in jsdom with Testing Library, covering render,
  error, loading, selection, tabs, the registration dialog, and fixture
  integrity.
- The queue is attention-first: compact rows grouped by repository, five views
  with live counts (Needs attention, In progress, Ready, All active, Archived),
  keyboard search across task/branch/repo/agent/file paths, and one primary state
  plus one recommended next action per row. Archived work is hidden by default,
  never deleted, and browsable through `GET /api/v1/work-units/archived`, which
  builds lightweight views without Git inspection. Archive, restore, bulk archive,
  and an explicit Unregister (files untouched) are available from the queue and
  the detail pane. First-run onboarding and per-view empty states guide a fresh
  workspace.
- The trusted-check experience is guided and evidence-backed: per-repository setup
  with a pre-approval preview of the exact command, directory, timeout, and
  requirement; repository proposals are promoted but inert until approval and
  never auto-run; "Run required checks" runs each approved required gate in order;
  check results render five visually distinct states (missing, running, passed,
  failed, stale) with a controlled output drawer; and a blocked merge readiness
  always states the next required action. Merge ready is shown only from the host's
  readiness verdict, which requires Git and every required current check to agree;
  internal numeric risk scores never reach the UI.
- CLI refuses `--lan`; LAN access remains closed until Phase 0b security exists.
- CLI accepts pnpm's standalone `--` argument separator, so the documented
  root-level start command forwards host options correctly.
- Storage defaults to the OS application-data directory. A relative `--data-dir`
  resolves against the directory pnpm was invoked from (`INIT_CWD`), so the root
  `pnpm start -- --data-dir .review-workspace` command lands in the repository
  root rather than `apps/host`.
- The SQLite database carries an explicit schema version (`PRAGMA user_version`)
  with ordered migrations. A legacy 0.2.0 database upgrades in place without
  losing registrations, gates, runs, or reviewed state.
- Host-owned storage is refused inside an observed worktree, both when a
  registration would enclose the data directory and when the data directory is
  moved into an already-registered worktree.
- Work units persist operator-controlled visibility (`active`/`archived`).
  Archive and unarchive hide or restore a registration without touching the
  worktree; bulk archive and a lightweight `GET /api/v1/work-units/archived`
  view complete the read surface.
- Read-only agent channel. Codex and Claude Code transcripts are discovered under
  `~/.codex/sessions` and `~/.claude/projects`, bound to a worktree by the `cwd`
  each session reports, and reduced to `working`, `stalled`, `idle`, or
  `unknown`. Only the file tail is read, results are cached by mtime, and the
  state is re-derived every pass so `working` decays to `stalled` on time alone.
  Privacy boundary (M7): sessions expose no message content, tool output, or raw
  transcript path — `sourcePath` was removed from the public `AgentSession` (a
  breaking schema change to `0.4.0-beta.0`), and a changed or unrecognized
  transcript format degrades to `unknown` rather than a guess.
- Agent activity is advisory and legible (M7). The web UI renders all four states
  as distinct pills, including a muted `no signal` pill instead of hiding the
  unknown state; `idle` is worded as a turn that *ended*, never as finished or
  correct; and the activity panel carries a standing note that a transcript only
  reports what the agent says it did, never affects merge readiness, and that
  Cursor is not observed because it does not write transcript files. The web
  shows only a bounded session id, never a transcript path. Codex and Claude Code
  reader fixtures cover realistic full turns, aborts, tool output, and unreadable
  formats.
- A worktree whose agent is mid-turn drops to the bottom of the queue; one whose
  agent stopped mid-turn is raised. Activity never affects merge readiness.
- The watcher survives an unreadable path instead of taking the host down.
- Open-source project surface: README covering both channels, a security policy
  with a threat model, contributing guide, code of conduct, changelog, issue and
  pull request templates, and CI running typecheck, tests, build, and the strict
  context check on Linux and Windows.
- `--version` and full `--help` on the CLI, both of which run without opening a
  database.

## Verification evidence

- TypeScript checks pass for the schema, adapter API, host, and web app.
- Fifty-two host tests pass, covering CLI argument forwarding, risk evidence,
  exact gate binding, native Git inspection, clean-branch merge checks, unchanged
  gate reuse, stale invalidation, untrusted repo gate proposals, the store
  migration, the work-unit archive API including the archived listing endpoint,
  incremental reconciliation, the per-file diff endpoint with path-traversal
  refusals, reviewed markers that reset when a patch changes or a file leaves
  the change set, and fourteen agent activity cases (open, closed,
  and aborted Codex turns with realistic message and tool-output fixtures, open
  and closed Claude Code turns with realistic content blocks, open turns that
  stopped writing, the three-minute staleness boundary, discovery-window expiry,
  unrecognized-format degradation to no signal, non-JSON transcripts, readable
  siblings beside an unreadable one, the privacy guarantee that message content
  and tool output never reach a session, sibling directories that share a name
  prefix, and most-specific worktree binding).
- Observed live against eighteen registered worktrees: the workspace correctly
  reported the Claude Code session editing it as `working` with an open turn,
  demoted it to the lowest queue tier, and raised the matching attention item.
- Registering the worktree that previously killed the daemon now logs
  `Watch degraded to polling for one path` and the host keeps serving.
- The schema/OpenAPI version contract test passes.
- The production web build succeeds.
- A compiled-daemon smoke test returns HTTP 200 for the app, workspace API,
  JSON Schema, and OpenAPI document.
- Browser QA with a temporary real Git repository verified ranked evidence,
  corrected checkbox sizing, unified diff rendering, gate approval/execution,
  reviewed-file persistence, and live updates. Temporary QA data was removed.
- Strict context validation passes.
- Windows integration-test cleanup guarantees service shutdown, retries removal
  of temporarily locked SQLite directories, and uses a 15-second timeout.
- Sixty-four web tests pass, covering empty, healthy, blocked, working/stalled
  agent, no-signal, archived, unavailable, 500-file, all four check-state
  fixtures, pending proposals, running checks, the 19-unit multi-repository
  dataset, plus global error, loading, queue selection, view filtering and
  grouping, search, per-view counts, archive/restore/bulk archive, diff-tab
  switching, the registration dialog, queueMeta derivations, the four distinct
  agent state labels, the advisory and Cursor copy, the agent-privacy guarantee,
  trusted-check setup and preview, inert proposals, run-required-checks order,
  the five distinct check states, the output drawer, blocked-readiness next
  actions, evidence-gated "Merge ready", and the fixture harness.

## Run locally

The canonical working copy is `C:\Users\madha\projects\review-workspace`.
Open PowerShell in that directory before running the commands below.

```powershell
cd C:\Users\madha\projects\review-workspace
pnpm install --frozen-lockfile
pnpm build
pnpm start -- --data-dir .review-workspace
```

Open `http://127.0.0.1:4317`, choose **Observe worktree**, and register existing
worktrees. Gate arguments are entered one argument per line.

## Intentionally gated

- No ACP/AHP, managed agents, isolated-worktree creation, chat, steering,
  approvals, cancellation, usage reporting, phone access, or generated UI. The
  agent channel observes; it does not control.
- Cursor activity is not observable through transcripts.
- The seven-day kill test and the AHP reducer spike are both still outstanding.

## Known limitations to observe during the kill test

- `stalled` cannot distinguish an interrupted agent from one inside a long tool
  call. The threshold is a fixed three minutes of transcript silence. Record
  false positives before tuning it.
- Transcript formats are undocumented and may change without notice. The reader
  degrades to `unknown` rather than guessing, so a format change looks like an
  absent agent. Watch for a work unit that reports no agent while one is clearly
  running.
- The pre-M2 forty-second first snapshot is gone. On the reference benchmark
  dataset (twenty worktrees, five with five-hundred-file diffs) a cold start
  serves the shell in about 130 ms, the first useful partial snapshot in about
  1.6 s, and a fully fresh snapshot in about 4.4 s. Run
  `pnpm benchmark:startup` to re-measure.
- Node's `node:sqlite` experimental warning is filtered in the CLI. It is
  emitted while the import graph links, before user code runs, so the store,
  service, and server are imported dynamically after the filter is installed.
  Anything that imports the store directly will still see the warning.
- Risk scope matching is deterministic and intentionally conservative; record
  false positives rather than adding model judgment during Phase 0a.
- Automatic post-turn gates do not exist without the managed-agent channel.
- The CLI is npx-ready in shape and now carries publish metadata, but the
  `@review-workspace` npm scope has not been reserved and nothing is published.
  The GitHub repository is renamed to `review-workspace`; the npm scope remains
  the only outstanding publication action.
- The contract's `needs review` and `clean` review states still have no single
  serialized schema value; they are derivable from review state, change presence,
  and gate results. This is a follow-up, not a contradiction.
