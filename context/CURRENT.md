# Current state

Last updated: 2026-08-20

Phase 0a is implemented as a usable local review workspace. The canonical
repository is published on `main` at
`https://github.com/Mvkd108/GenUI-Harness`; the initial source checkpoint is
commit `bebd094`.

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
  gate management and logs, ordered SSE snapshots, and periodic plus watched
  reconciliation.
- CLI refuses `--lan`; LAN access remains closed until Phase 0b security exists.
- CLI accepts pnpm's standalone `--` argument separator, so the documented
  root-level start command forwards host options correctly.
- Read-only agent channel. Codex and Claude Code transcripts are discovered under
  `~/.codex/sessions` and `~/.claude/projects`, bound to a worktree by the `cwd`
  each session reports, and reduced to `working`, `stalled`, `idle`, or
  `unknown`. Only the file tail is read, results are cached by mtime, and the
  state is re-derived every pass so `working` decays to `stalled` on time alone.
- A worktree whose agent is mid-turn drops to the bottom of the queue; one whose
  agent stopped mid-turn is raised. Activity never affects merge readiness.
- The watcher survives an unreadable path instead of taking the host down.

## Verification evidence

- TypeScript checks pass for the schema, adapter API, host, and web app.
- Fourteen host tests pass, covering CLI argument forwarding, risk evidence,
  exact gate binding, native Git inspection, clean-branch merge checks, unchanged
  gate reuse, stale invalidation, untrusted repo gate proposals, and seven agent
  activity cases: open and closed Codex turns, an open Claude Code tool call, an
  open turn that stopped writing, discovery-window expiry, sibling directories
  that share a name prefix, and most-specific worktree binding.
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
- Starting the host against eighteen worktrees takes roughly forty seconds of
  CPU before the first snapshot, dominated by Git inspection of large diffs.
- SQLite still emits Node's experimental-feature warning in Node 24.
- Risk scope matching is deterministic and intentionally conservative; record
  false positives rather than adding model judgment during Phase 0a.
- Automatic post-turn gates do not exist without the managed-agent channel.
- The CLI is npx-ready in shape but no package name has been reserved or published.
