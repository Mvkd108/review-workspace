# Review Workspace

A local-first workspace for reviewing what coding agents actually did.

Agents are good at producing branches and bad at telling you which ones are safe
to merge. Review Workspace watches the Git worktrees on your machine, ranks them
by concrete review reasons, runs only the checks you approved, and says whether a
branch is ready — with the evidence attached.

It observes. It never drives an agent, and it never deletes a worktree.

```
pnpm start -- --data-dir .review-workspace
# then open http://127.0.0.1:4317
```

## Why it exists

Dispatching work to agents is a solved problem. Absorbing the output is not.
The bottleneck is verification: which branch needs attention, why, and is it
safe to merge. Review Workspace treats the reviewable unit as a **worktree**
rather than a chat thread, so work from Codex, Claude Code, Cursor, or a human
is reviewed the same way, with no migration and no agent integration required.

## Two channels

**The repo channel** reads Git and only Git. Branch and base identity, dirty
state, committed and untracked changes, ahead/behind counts, diffs, and
non-mutating merge-conflict checks. Git output is authoritative; there is no
JavaScript reimplementation of Git behind the merge claims.

**The agent channel** reads agent-owned transcript files to answer the one
question Git cannot: *is the agent still working, or did it stop?*

| Agent | Observed | How |
| --- | --- | --- |
| Codex | yes | `~/.codex/sessions` — `task_started` / `task_complete`, `cwd` in `session_meta` |
| Claude Code | yes | `~/.claude/projects` — assistant `stop_reason`, `cwd` per entry |
| Cursor | no | stores chat in a VS Code SQLite database, not transcript files |

A worktree whose agent is mid-turn drops to the bottom of the queue, because
reviewing it is premature. One whose agent stopped mid-turn is raised, because
something probably broke. Activity never feeds merge readiness — a transcript
reports what an agent *believes* it did, and only Git says what changed.

Anything the agent channel cannot determine reads as `unknown` rather than a
guess. An absent agent and an unrecognised transcript format look the same on
purpose.

## Trusted gates

Gates are the checks that back a merge-readiness claim — your test suite, your
linter, your build.

- Definitions live in host-owned storage **outside** the worktree, so a branch
  cannot alter the checks that judge it.
- A repository may ship `.review-workspace-gates.json`, but it is only ever a
  **proposal**. The host normalises and hashes it and will not execute it until
  you approve it explicitly.
- Execution is structured (`shell: false`), with an environment allowlist,
  output limits, and timeouts.
- Results are pinned to the exact diff fingerprint they ran against, so a result
  goes stale the moment the code moves under it.

## Requirements

- **Node.js 24 or newer.** The host uses the built-in `node:sqlite` module.
- **pnpm 11 or newer.**
- **Git** on your `PATH`.

## Install and run

```bash
npx @review-workspace/host@beta
```

Nothing is installed permanently and no configuration is needed. Review state and
approved checks are stored in your OS application-data directory, deliberately
outside every observed worktree.

Open `http://127.0.0.1:4317`, choose **Observe worktree**, and point it at any
existing Git worktree. Registration is the only manual step — after that, edits
show up on their own, within about 350ms of a file settling.

To work on Review Workspace itself, build from source instead:

```bash
pnpm install && pnpm build && pnpm start
```

```
review-workspace [--data-dir PATH] [--port PORT] [--open] [--version]
```

The server binds to `127.0.0.1`. `--lan` is deliberately refused: remote access
needs pairing, lockout, and device revocation, and none of that exists yet.

## Design principles

- Git and trusted gates are authoritative.
- Risk is shown as **reasons**, never as a score. The numeric sort key exists but
  is never rendered.
- Existing worktrees are never deleted implicitly.
- Never invent monetary cost estimates from token usage.
- Observation over control: the workspace reads agent output, it does not steer.

## Project status

**Beta — `0.4.0-beta.0`.** Used daily against real worktrees, with integration,
security, accessibility, and packaging suites green on Linux and Windows.

Pre-1.0, so the schema may still change. Two things are worth knowing before you
rely on it:

- The seven-day kill test that governs beta completion is **still running** —
  one day recorded so far. Until it finishes, "does this hold up in daily use"
  is an open question rather than a settled one, and the criteria it must meet
  are written down in [`context/LAUNCH_CONTRACT.md`](context/LAUNCH_CONTRACT.md).
- `stalled` uses a fixed three-minute threshold of transcript silence, and
  cannot yet distinguish an interrupted agent from one inside a long tool call.
  Expect the occasional false positive there.

The repo channel and the read-only agent channel are implemented. Managed agent
sessions, steering, approvals, cancellation, phone access, and generated UI are
**not**, and are gated behind a feasibility spike that has not run. See
[`context/`](context/) for the full state, the decision log, and the ordered next
steps; it is the durable handoff for both people and agents.

The public integration artifact is the workspace schema, published as
[JSON Schema](packages/workspace-schema/schema/workspace.schema.json) and
[OpenAPI](packages/workspace-schema/openapi.json), and kept independent of any
particular agent protocol.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture map, the development
loop, and how to add support for another agent's transcripts. Security reports
go through [SECURITY.md](SECURITY.md) — please do not open a public issue for a
vulnerability.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
