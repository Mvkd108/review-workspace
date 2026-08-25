# Session handoff — 2026-08-23 (M7 agent activity reliability, UX, privacy)

## Outcome

Made advisory agent state honest, legible, and safe. The four states are now
distinct in the UI including a visible `no signal`; activity is explicitly
advisory and never affects merge readiness; the raw transcript path is gone from
the public API; and the reader's unknown-format fallback is verified by tests.

## What changed

- `packages/workspace-schema`: `AgentSession.sourcePath` removed. Breaking
  change, so `WORKSPACE_SCHEMA_VERSION` moved `0.3.0-beta.2` → `0.4.0-beta.0`
  across the types, JSON Schema (`$id`, `const`, and the `agentSession` def),
  OpenAPI version, and the schema contract test. The contract test now locks the
  exact public field set and asserts no content/message/output/payload key can
  appear on a session.
- `apps/host/src/agent-activity.ts`: sessions no longer emit `sourcePath`; the
  path stays internal for discovery, caching, and binding. Comments now state the
  privacy boundary, the advisory nature, and that the three-minute threshold is
  not to be tuned without usage evidence.
- `apps/host/src/agent-activity.test.ts`: expanded from 7 to 14 cases. New
  realistic Codex and Claude Code fixtures (session_meta with cwd, task_started /
  task_complete, assistant message blocks, function_call + function_call_output,
  turn_aborted; Claude entries with uuid/cwd/sessionId/content arrays, tool_use,
  end_turn). New tests: aborted turn treated as ended, three-minute boundary,
  unknown-format degradation, summary-only transcripts, non-JSON transcripts,
  readable sibling beside an unreadable one, and a privacy lock asserting message
  content and tool output never reach a session and the public field set is exact.
- `apps/web/src/features/activity/AgentPill.tsx`: `unknown` now renders a muted
  `No agent signal` pill instead of `null`; idle tooltip says a last turn ending
  does not mean the work is done or correct.
- `apps/web/src/features/activity/AgentPanel.tsx`: empty state is honest ("none
  was found, or a format changed and the workspace chose not to guess"), a
  standing advisory note explains activity never affects merge readiness and that
  Cursor is not observed, `turn complete` → `turn ended`, and the session list no
  longer renders a transcript path (bounded session id only).
- `apps/web/src/features/activity/activity.css`: `.agent-unknown` pill styling
  and the `.agent-advice` footnote.
- `apps/web/src/fixtures/workspaces.ts`: session fixtures carry no `sourcePath`;
  new `Agent no signal` fixture. (A parallel agent session was editing this tree
  concurrently; fixtures were reconciled to the current state.)
- `apps/web/src/test/activity.test.tsx` (new): four distinct labels, open/ended
  turn wording, no-signal vs idle, advisory + Cursor copy, and the
  no-path/no-payload privacy check.
- `apps/web/src/test/fixtures.test.ts`: covers every agent state and asserts no
  session in any fixture carries a transcript path or payload key.

## Checks run

- `pnpm --filter @review-workspace/schema build && test`: 5 pass.
- `pnpm --filter @review-workspace/host typecheck`: pass.
- `pnpm --filter @review-workspace/host test`: 49 pass (14 agent activity).
- `pnpm --filter @review-workspace/web typecheck`: pass.
- `pnpm --filter @review-workspace/web test`: 59 pass (9 activity).
- `pnpm --filter @review-workspace/web build`: pass; harness chunk stays separate.
- `pnpm typecheck`: pass across all packages.

## Notes and follow-ups

- A second agent was editing this workspace at the same time (gates UX,
  incremental reconciliation, and overlapping M7 bullets in the context files).
  The tree was reconciled and the suites pass, but review `git diff` before
  committing; the two streams of work have not been committed separately.
- The three-minute stalled threshold is unchanged on purpose. The kill test
  should record false positives (a long tool call reported as `stalled`) before
  anyone tunes it.

## Exact continuation point

Continue the seven-day kill test as the primary activity, using the agent channel
through the UI now that all four states are legible. Record disagreements between
reported state and reality per `NEXT.md`. Before committing this slice, review the
interleaved working tree for conflicts from the parallel session.
