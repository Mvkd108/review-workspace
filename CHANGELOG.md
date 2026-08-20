# Changelog

Notable changes to Review Workspace. Versions refer to the published workspace
schema, which is the project's public contract.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).
While the project is pre-1.0, minor versions may change the schema.

## [Unreleased]

### Added

- Open-source project documentation: contributing guide, security policy with a
  threat model, code of conduct, and this changelog.
- Continuous integration on Linux and Windows covering typecheck, tests, build,
  and the context handoff check.
- `--version` on the CLI, and expanded `--help` output.

### Changed

- Published packages now expose generated declarations rather than TypeScript
  sources, and carry repository and homepage metadata.

### Fixed

- `pnpm test` failed on a clean clone. The host imports runtime values from
  `workspace-schema`, which resolves to compiled output, so the suite could only
  pass where a previous build had left `dist/` behind. The test script now builds
  the library packages first. Found by the first CI run.

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
