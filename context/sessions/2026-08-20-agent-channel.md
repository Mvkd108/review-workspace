# Session handoff — 2026-08-20

## Outcome

Registered the operator's real worktrees, then implemented the first Phase 0b
slice: a read-only agent channel that reports whether an agent is still working
in a worktree. Phase 0b was started with both of its gates unmet, by explicit
owner decision recorded in `DECISIONS.md`.

## Why this was built now

The repo channel observes Git, so it sees what an agent wrote but not whether
the agent is still writing. The operator does not push until an agent finishes,
and had no way to tell a finished worktree from an in-progress one without
opening its terminal. `PHASE0A_KILL_TEST.md` already asked for that friction to
be logged; it was reported directly instead.

## What was implemented

- `packages/workspace-schema`: `AgentActivityState`, `AgentSession`,
  `AgentActivity`, an `agentActivity` field on `WorkUnitView`, and two attention
  kinds. Schema version bumped to `0.2.0` across the types, JSON Schema,
  OpenAPI document, and contract test.
- `apps/host/src/agent-activity.ts`: transcript discovery, `cwd` extraction,
  turn-boundary detection, state derivation, mtime caching, and segment-aware
  worktree binding.
- `apps/host/src/workspace-service.ts`: one transcript scan per refresh shared
  across work units, activity in every view, attention items, queue demotion for
  an open turn and promotion for a stalled one, and a watcher error handler.
- `apps/web`: an activity pill on each queue card and in the detail header, plus
  an evidence panel listing observed sessions.

## Signals the state is derived from

Codex brackets a turn with `task_started` and `task_complete` event messages and
records `cwd` in its `session_meta` header. Claude Code records `cwd` per entry
and closes a turn with an assistant `stop_reason` of `end_turn`; a trailing tool
call or an unanswered user message means the turn is open. Both are found by
scanning the file tail backwards, so a long transcript costs the same as a short
one.

## Checks run

- Full build: pass.
- Full test suite: 15 tests pass, 7 of them new.
- Strict context check: pass.
- Live verification against eighteen registered worktrees. The workspace
  reported the Claude Code session editing this repository as `working` with an
  open turn, demoted it to the lowest queue tier, and raised the matching
  attention item. The browser rendered the pill, the pulsing indicator, and the
  session evidence row.

## Defect fixed along the way

Registering a repository that contained a permission-locked pytest cache
directory killed the entire daemon twice. Chokidar raised `EPERM` on `realpath`
and emitted an unhandled `error` event, which is fatal in Node, so one
unreadable path took down all seventeen other work units. The watcher now
reports each distinct failure once and leaves that path to interval polling.
Re-registering the same repository afterwards left the host serving normally.

## Registered worktrees

Eighteen: one repository checkout together with its eleven sibling agent
worktrees, six further standalone repositories, and this repository. Two
detached-HEAD worktrees under a Claude Code temporary scratchpad were
deliberately excluded. Names are omitted because this repository is public.

## Exact continuation point

Use the agent channel during ordinary work and record where the reported state
disagrees with reality, then run the seven-day kill test, which is still
unstarted. Do not add control surfaces before the AHP reducer spike, which has
no definition anywhere in this repository.
