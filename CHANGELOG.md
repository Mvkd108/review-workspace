# Changelog

Notable changes to Review Workspace. Versions refer to the published workspace
schema, which is the project's public contract.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).
While the project is pre-1.0, minor versions may change the schema.

## [0.4.0-beta.0] — 2026-08-25

First public release. This is a **beta**: the software is used daily against
real worktrees and every automated check passes on Linux and Windows, but the
seven-day kill test defined in `context/LAUNCH_CONTRACT.md` is still running —
day 1 of 7 was recorded on 2026-08-24. Beta completion is not claimed, and the
managed-agent work the kill test gates has not begun.

All published package versions now match `WORKSPACE_SCHEMA_VERSION`, and a
contract test enforces that, so the version a consumer pins always describes the
schema it receives.

### Fixed

- **The host-data-directory containment guard could fail open on Windows.**
  Windows exposes one directory under both an 8.3 short alias
  (`C:\Users\RUNNER~1`) and its long form, and `path.resolve` preserves whichever
  spelling it is given. Git reports the long form, so a worktree registered
  through a short path compared unequal to the same directory reached the long
  way. Two consequences: the guard that refuses to place the host database inside
  an observed worktree answered "not contained" and allowed the registration, and
  one repository could receive two different `repositoryId` values, orphaning its
  approved gates. Paths are now canonicalised through the native `realpath`
  before comparison and before identity is derived. Found by the first CI run of
  the integration and security suites on a Windows runner.

### Added

- Open-source project documentation: contributing guide, security policy with a
  threat model, code of conduct, and this changelog.
- Continuous integration on Linux and Windows covering typecheck, tests, build,
  and the context handoff check.
- `--version` on the CLI, and expanded `--help` output.
- Agent activity is legible in every state: `working`, `stalled`, `idle`, and a
  distinct `no signal` are rendered as separate pills, and the activity panel
  carries a standing note that transcripts are advisory, never affect merge
  readiness, and that Cursor is not observed.
- End-to-end integration suite covering a clean first run, registration,
  archive/restore, gate-proposal approval, check execution and failure, stale
  results after an edit, reviewed-file invalidation, SSE with disconnect and
  recovery, an unavailable worktree, database migration plus restart, and a
  500-file review.
- Negative-security suite covering loopback-only CORS, static and API path
  traversal, unapproved commands never executing, transcript leakage through
  the snapshot API, unsafe data locations, and the request body cap.
- Accessibility: axe scans across key fixtures and keyboard-flow tests; the
  dialog traps Tab, closes on Escape, and returns focus to its trigger.
- A packed-install smoke test (`pnpm smoke`, run in CI) verifying the CLI
  surface without opening a database, the compiled daemon's HTTP surface, and a
  clean `pnpm pack --dry-run` for the host.

### Changed

- The host build excludes test files and clears stale assets, so a packed
  tarball contains only the CLI, its assets, and the schema documents.

- Published packages now expose generated declarations rather than TypeScript
  sources, and carry repository and homepage metadata.
- `AgentSession` no longer exposes the raw transcript path (`sourcePath` was
  removed from the public schema). Message content and tool output never entered
  snapshots and still do not; the reader now has explicit regression coverage.
  The schema version is `0.4.0-beta.0` because the removal is breaking.
- An `idle` agent is described as a turn that *ended*, never as finished or
  correct.

### Fixed

- `WorkspaceService.stop()` could close the store while a background
  reconciliation was still running, making a shutdown refresh touch a closed
  database. It now awaits any in-flight reconciliation before closing.
- `pnpm test` failed on a clean clone. The host imports runtime values from
  `workspace-schema`, which resolves to compiled output, so the suite could only
  pass where a previous build had left `dist/` behind. The test script now builds
  the library packages first. Found by the first CI run.
- The CLI options test asserted a hardcoded Windows path, so it failed anywhere
  else: `C:\workspace` is not absolute on POSIX, and `path.resolve` therefore
  prefixed the runner's working directory. The suite now derives an absolute path
  for the current platform. Parser behaviour was correct throughout; only the
  test was wrong. Found by the first CI run on Linux.

## [0.2.0] — 2026-08-20

### Added

- **Agent channel.** Reports whether an agent is still working in a worktree, by
  reading transcripts the agent already writes. Codex is observed through
  `task_started` / `task_complete` boundaries and the `cwd` in its `session_meta`
  header; Claude Code through the assistant `stop_reason` and its per-entry
  `cwd`. Sessions resolve to `working`, `stalled`, `idle`, or `unknown`.
- `agentActivity` on `WorkUnitView`, with `AgentActivity`, `AgentSession`, and
  `AgentActivityState` in the public schema.
- `agent-working` and `agent-stalled` attention kinds.
- Agent state in the web client: a queue and detail pill, and an evidence panel
  listing observed sessions.

### Changed

- Queue ranking accounts for agent state. A worktree with an open turn is
  demoted, because reviewing it is premature; one that stopped mid-turn is
  promoted. Agent state never affects merge readiness.

### Fixed

- Registering a worktree that contained a permission-locked directory killed the
  entire daemon. Chokidar emitted an unhandled `error` event for an `EPERM` on
  `realpath`, which is fatal in Node, so a single unreadable path took down every
  other work unit. The watcher now reports each distinct failure once and falls
  back to interval polling for that path.

### Known limitations

- Cursor is not observable. It stores chat in a VS Code SQLite database rather
  than transcript files.
- `stalled` cannot distinguish an interrupted agent from one inside a long tool
  call. The threshold is three minutes of transcript silence.
- Transcript formats are undocumented and may change. The reader degrades to
  `unknown` rather than guessing, so a format change looks like an absent agent.

## [0.1.0] — 2026-08-18

### Added

- Initial release: the repo channel.
- Unmanaged worktree registration for Codex, Claude Code, Cursor, or any other
  tool, with no agent integration required.
- Native Git inspection for branch and base identity, dirty state, committed and
  untracked changes, ahead/behind counts, diffs, fingerprints, and non-mutating
  merge-conflict checks.
- Deterministic reason-first risk ranking. The internal numeric score is never
  rendered.
- Host-owned trusted gates: SQLite-stored definitions, structured `shell: false`
  execution, environment allowlisting, output limits, timeouts, definition
  hashing, exact diff fingerprint binding, stale detection, and unchanged-result
  reuse.
- `.review-workspace-gates.json` read as a hash-stamped proposal that requires
  explicit approval before the host will persist or execute it.
- React desktop client with a ranked queue, evidence panels, unified diff,
  reviewed-file tracking, gate management, and live updates over ordered SSE.
- Public workspace schema published as JSON Schema and OpenAPI.
- Localhost-only binding; `--lan` refused pending pairing and device security.
