# Current state

Last updated: 2026-08-18

Phase 0a is implemented as a usable local review workspace. The canonical
repository is being checkpointed to
`https://github.com/Mvkd108/GenUI-Harness` before the usage test begins.

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

## Verification evidence

- TypeScript checks pass for the schema, adapter API, host, and web app.
- Seven host tests pass, covering CLI argument forwarding, risk evidence, exact
  gate binding, native Git
  inspection, clean-branch merge checks, unchanged gate reuse, stale invalidation,
  and untrusted repo gate proposals.
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
  approvals, cancellation, usage reporting, phone access, or generated UI.
- The seven-day Phase 0a kill test must pass before the AHP reducer spike.
- Phase 0b must not begin until that spike records a binary decision.

## Known limitations to observe during the kill test

- SQLite still emits Node's experimental-feature warning in Node 24.
- Risk scope matching is deterministic and intentionally conservative; record
  false positives rather than adding model judgment during Phase 0a.
- Automatic post-turn gates do not exist without the managed-agent channel.
- The CLI is npx-ready in shape but no package name has been reserved or published.
