# Contributing

Thanks for taking a look. This document covers the development loop, how the
code is laid out, and the two conventions that are easy to miss.

## Requirements

- Node.js 24+ (the host uses the built-in `node:sqlite` module)
- pnpm 11+
- Git on your `PATH`

## Development loop

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm start -- --data-dir .review-workspace
```

`pnpm dev` runs the host and the Vite dev server together with hot reload.

The host imports runtime values from the library packages, and those resolve to
their compiled output, so `pnpm test` builds `workspace-schema` and `adapter-api`
first. That happens automatically — the commands above work on a fresh clone in
the order shown.

Tests use Vitest for the host and the web app, and `node --test` for the schema
contract. The Git tests create real temporary repositories and shell out to real
`git`; they are slower than unit tests and that is deliberate, because a mocked
Git would not be evidence of anything.

## Layout

| Path | What lives there |
| --- | --- |
| `packages/workspace-schema` | Public types, JSON Schema, OpenAPI. The integration artifact. |
| `packages/adapter-api` | Repository, gate, agent, and event adapter interfaces. |
| `apps/host` | Git adapter, SQLite store, gate execution, risk, agent channel, HTTP/SSE server, CLI. |
| `apps/web` | React desktop client. |
| `context/` | Durable project state — read this first. |

Inside `apps/host/src`, the pieces worth knowing:

- `git-adapter.ts` — every Git call. Native `git`, `shell: false`, read-only.
- `agent-activity.ts` — the agent channel: transcript discovery and turn state.
- `gate-provider.ts` — structured process execution for trusted gates.
- `risk.ts` — deterministic reason derivation.
- `workspace-service.ts` — assembles snapshots and publishes them over SSE.
- `store.ts` — host-owned SQLite.

## Two conventions that are easy to miss

**Read `context/` before changing behaviour.** `context/PRODUCT.md` states what
is deliberately out of scope, and `context/DECISIONS.md` records choices that
should not be rediscovered by accident — such as why Git is authoritative and
why gates are host-owned. After a coherent slice, update `context/CURRENT.md`
with what you actually verified, reorder `context/NEXT.md`, and add a dated note
under `context/sessions/`. `pnpm context:check:strict` validates the handoff.

**Evidence over assertion.** Merge-readiness claims must be traceable to Git
output or a gate result pinned to the exact diff. If a check cannot be
substantiated, it should report `unknown` rather than a plausible guess. Several
parts of the design exist only to preserve this, so a change that quietly relaxes
it is a bigger change than it looks.

## Design constraints

These are load-bearing. A pull request that breaks one needs to argue for it.

- Git output is authoritative. Do not add a JavaScript Git model behind a merge
  claim.
- Gate definitions stay outside observed worktrees and are pinned by hash. A
  repository file is a proposal until a human approves it.
- Risk is shown as reasons. The numeric sort key must never reach the UI.
- Never delete or mutate a registered worktree.
- The agent channel observes and does not control.
- Never invent monetary cost estimates from token usage.

## Adding support for another agent

The agent channel reads transcripts an agent already writes; it does not require
the agent's cooperation. To add one, you need two things from its transcript:

1. **A working directory**, so a session can be bound to a worktree. See
   `findCwd` in `agent-activity.ts`.
2. **A turn boundary**, so an open turn can be told from a finished one. Codex
   uses `task_started` / `task_complete`; Claude Code uses the assistant
   `stop_reason`. Add a sibling of `codexTurnComplete`.

Read from the file tail so cost does not grow with transcript length, return
`undefined` when the format is unrecognised rather than guessing, and never copy
message content or tool output into the session record.

Cursor is currently unsupported because it stores chat in a VS Code SQLite
database rather than transcript files. That would be a spike, not a patch.

## Pull requests

- Keep the change to one coherent slice.
- `pnpm typecheck`, `pnpm test`, and `pnpm build` must pass. CI runs them on
  Linux and Windows.
- Add a test when you fix a bug. The regression is the point.
- Update `context/` when behaviour changes.
- Match the surrounding style. There is no formatter config; the code is dense
  and consistent, so follow the file you are in.

## Conduct and security

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
Vulnerabilities go through [SECURITY.md](SECURITY.md), not the public issue
tracker.

By contributing, you agree your contributions are licensed under Apache-2.0.
