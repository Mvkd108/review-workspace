# Session handoff — 2026-08-18

## Outcome

Implemented and visually verified the complete Phase 0a vertical slice. The app
can now be used for the seven-day kill test. Phase 0b was deliberately not
started because the approved plan gates it on usage evidence and an AHP spike.

## Major artifacts

- `packages/workspace-schema`: public TypeScript model, JSON Schema, and OpenAPI.
- `packages/adapter-api`: repository, gate, agent, and event adapter contracts.
- `apps/host`: native Git adapter, SQLite store, trusted process gates, risk
  derivation, workspace service, local API/SSE server, and CLI.
- `apps/web`: ranked desktop queue, worktree registration, evidence, diff,
  review state, gate proposals, trusted gates, and logs.
- Root Apache-2.0 licensing, scripts, README, and permanent context system.

## Checks run

- All four TypeScript projects: pass.
- Host tests: 7 pass.
- Schema/OpenAPI contract: 1 pass.
- Production web build: pass.
- Compiled daemon and static/API/schema smoke check: pass.
- Strict context check: pass.
- Browser QA on a temporary real Git repository: pass after correcting checkbox
  sizing; diff, gate execution, persistence, and live updates confirmed.

## Cleanup

The temporary QA Git repository, SQLite data, and server process were removed.
Build outputs and dependencies remain ignored by Git.

## Exact continuation point

Review the uncommitted Phase 0a repository, create the initial checkpoint, then
start the seven-day test using `context/PHASE0A_KILL_TEST.md`. Do not implement
ACP/AHP or phone access yet.

## Relocation

The canonical working copy was relocated to
`C:\Users\madha\projects\review-workspace` so ordinary PowerShell sessions can
install, build, and run it without depending on the Codex project-mirror path.
The repository explicitly approves only esbuild's install script under pnpm's
dependency build policy.

Relocation verification in the canonical directory:

- Frozen-lockfile install: pass.
- Production build: pass.
- Test suite: 8 tests pass (1 schema contract and 7 host tests).
- Strict context handoff check: pass.

## PowerShell start-command correction

The first run from the canonical directory exposed pnpm forwarding a standalone
`--` into the host CLI. The parser now ignores that separator, with a regression
test covering `pnpm start -- --data-dir .review-workspace`. A real launch smoke
test using the nested root command reached the ready state successfully; its
temporary database was removed afterward.

## Initial GitHub checkpoint

The owner authorized publishing the completed Phase 0a slice to
`https://github.com/Mvkd108/GenUI-Harness`. The destination was verified empty.
Before checkpointing, the full build, TypeScript check, strict context check,
schema contract test, and seven host tests passed. A Windows-only timing failure
observed during the checkpoint run was corrected by guaranteeing service
shutdown, retrying temporary-directory cleanup, and increasing the integration
test timeout to 15 seconds; the complete test suite then passed.

The initial source checkpoint was committed as `bebd094` with message
`feat: build phase 0a review workspace` and pushed to `origin/main`. The remote
is `https://github.com/Mvkd108/GenUI-Harness`, and the local `main` branch now
tracks `origin/main`. The next action is the seven-day Phase 0a kill test.
