# Launch contract

Freeze date: 2026-08-22

This document is the architecture freeze and scope guard for Review Workspace.
Every subsequent model must work from these definitions. Changing this contract
requires an explicit owner decision and a new dated freeze.

## Product identity

- **Product name:** Review Workspace.
- **Repository name:** `review-workspace`. The GitHub repository lives at
  `https://github.com/Mvkd108/review-workspace` and was renamed from
  `GenUI-Harness` on 2026-08-22.
- **Package name:** the public npm scope is `@review-workspace`, with packages
  `@review-workspace/schema`, `@review-workspace/adapter-api`,
  `@review-workspace/host`, and `@review-workspace/web`. The root package is the
  private `review-workspace-monorepo`.
- **Versioning policy:** semver, schema-locked.
  - During beta all packages stay `0.x`. Breaking changes bump the minor
    version; new backward-compatible behavior bumps the patch version.
  - A schema change bumps `WORKSPACE_SCHEMA_VERSION` and the JSON Schema,
    OpenAPI document, and schema/OpenAPI contract test in the same commit.
    Nothing may release with the schema, OpenAPI, and schema version out of
    step.
  - `1.0.0` is the stable contract boundary. After it, the public schema is
    governed by strict semver; nothing less than a new major may break it.

## Beta definition

The beta is a **local-only review workspace for unmanaged Git worktrees**.

- **Local-only:** the server binds to `127.0.0.1` and serves a single operator
  on the same machine. `--lan` is refused. There is no pairing, no multi-user,
  no mobile client.
- **Unmanaged:** work units are registered worktrees that the workspace observes
  through Git and, where possible, through agent-owned transcript files. The
  workspace never launches, steers, cancels, or holds an agent session.
- **Review surface:** the operator decides what needs attention, what to review,
  and what to merge. The workspace ranks, evidences, and gates; it never decides
  for the operator and never mutates the worktree beyond reading it.

## Authoritative states

These four vocabularies are the contract's definitions of truth. Every UI label,
schema value, and code path must map to exactly one state per vocabulary. When
schema type names differ from this vocabulary, the contract names are
authoritative and the schema names are the current implementation mapping.

### Agent — state of the agent in a worktree

| State | Definition |
| --- | --- |
| `working` | The agent is actively working right now: an open turn or tool call is in progress and there is recent transcript activity. |
| `stalled` | The agent stopped without completing its turn or tool call: the transcript shows no completion record and has been silent past the staleness threshold (three minutes). This does not explain *why* it stopped; an interrupted agent and one inside a long tool call look identical. |
| `idle` | The agent completed its last turn and is not working. An explicit end-of-turn record exists and there is no newer activity. |
| `no signal` | The workspace cannot determine the agent's state: no transcript exists, the transcript format is unrecognized, or no session binds to the worktree. An absent agent and an unrecognized format look identical on purpose; the workspace never guesses. |

Schema mapping: `working`, `stalled`, `idle`, and `no signal` correspond to the
`AgentActivityState` values `working`, `stalled`, `idle`, and `unknown`.

Activity never feeds merge readiness. A transcript reports what an agent
believes it did; only Git says what changed.

### Work unit — lifecycle of a registered worktree

| State | Definition |
| --- | --- |
| `active` | Registered and being observed. Both channels (Git and agent, where possible) are live, and new activity updates the work unit. |
| `archived` | The operator explicitly archived the work unit. It is retained in the workspace but no longer observed for new activity. **Archived worktrees are never deleted, implicitly or otherwise.** |
| `unavailable` | The worktree cannot currently be observed: its path is unreadable, its repository is missing, or its registration is invalid. The work unit stays registered and degrades rather than disappears; interval polling and Git inspection still attempt it. |

Schema mapping: `active` and `unavailable` correspond to the
`WorkUnitLifecycle` values `observing` and `unavailable`. The current `lifecycle`
values `ready-for-review` and `blocked` belong to the **Review** vocabulary
below, not the lifecycle; aligning the schema names with this contract is an
outstanding follow-up.

A work unit is bound to a repository and a worktree, never to a chat thread.
Unregistered worktrees are outside the workspace entirely and are likewise never
deleted by it.

### Review — what the operator must do with a work unit

| State | Definition |
| --- | --- |
| `needs attention` | Something requires the operator now: a merge conflict, a failed required gate, a stalled agent, or another raised attention item. |
| `needs review` | The work unit has changes that have not been reviewed yet. Review is required before a merge-readiness claim. |
| `blocked` | The work unit cannot be merged: merge conflicts exist, or a required gate failed. Blocking is caused by Git or gate truth, never by agent activity. |
| `ready` | Reviewed and all required checks pass for the current diff fingerprint. This is the only state that authorizes a merge-readiness claim of ready. |
| `clean` | No changes exist since the last checkpoint or merge. There is nothing to review or merge. |

Schema mapping: `ready` and `blocked` correspond to the `MergeReadinessStatus`
values `ready` and `blocked`; `needs attention` corresponds to the presence of
raised `AttentionItem` records. `needs review` and `clean` currently have no
single schema value and must be derivable from review state, change presence,
and gate results.

### Checks — the state of a gate result

| State | Definition |
| --- | --- |
| `missing` | No gate definition and no run exist for the checks that back the merge-readiness claim. A claim of ready is impossible while a required check is missing. |
| `running` | A gate is executing right now. The result is not yet truth. |
| `passed` | The gate ran and exited successfully against the current diff fingerprint. |
| `failed` | The gate ran and did not pass against the current diff fingerprint: non-zero exit or execution error (crash, timeout, missing command, environment failure). |
| `stale` | A run exists but its fingerprint no longer matches the current diff, so its result proves nothing about the current change. |

Schema mapping: `running`, `passed`, `failed`, and `stale` correspond to the
`GateRunStatus` values of the same name. The schema's separate `error` value is
a subcase of the contract's `failed`.

## Worktree preservation

Archived and unregistered worktrees are **never deleted**. The workspace may
read, fingerprint, and register them, but no code path may remove a worktree,
check out over it, or clean its working directory. Delete is an explicit
operator action taken with Git directly, and the workspace never performs it
implicitly.

## Frozen performance targets

| Target | Definition |
| --- | --- |
| UI shell within two seconds | The web application shell renders and is interactive within two seconds of opening the page. This covers the static bundle and shell, not the first data. |
| Useful workspace within five seconds | With approximately 20 registered work units, a useful workspace — a populated, ranked queue plus its attention and state — is available within five seconds of the page loading against a warm daemon. |
| No diff row explosion | A 500-file change must not create hundreds of simultaneous DOM rows. Diff views render a bounded window (paged or virtualized); the DOM never materializes one row per changed file at once. |

These are load-bearing design constraints. A change that trades any of them away
without an owner decision is a contract violation.

## Explicit exclusions

The following are out of scope for the beta and must not be built without a new
owner decision:

- **Agent control:** launching, steering, approving, cancelling, or holding
  agent sessions. The agent channel observes transcripts and nothing else.
- **LAN access:** any binding beyond `127.0.0.1`, pairing, or remote use.
- **Phone access:** any mobile or non-desktop client surface.
- **Cursor transcript reading:** Cursor stores chat in a VS Code SQLite database,
  not transcript files. Its activity is not observable through the agent
  channel, and the database is not a supported source.
- **Generated UI:** the review surfaces — navigation, diff, approval, and stop —
  stay hand-built. Declarative generated views are deferred behind the managed
  workflow gate in `PRODUCT.md`.

## Beta completion criteria

The beta is complete only when all of the following hold with recorded evidence:

1. The seven-day kill test passes with its required exposure: seven consecutive
   days, at least ten real work units, at least three concurrently active
   worktrees, and both Codex and Claude Code work included.
2. The performance targets above are met in daily use.
3. Every state in this contract has a schema value or a deterministic derivation
   that the web application renders, and the schema names no longer conflict
   with this vocabulary.
4. The GitHub repository is named `review-workspace`. (Met on 2026-08-22.)
5. The strict context check passes from a clean checkout.
6. Merge-readiness claims have agreed with manual Git inspection throughout the
   test period.

## Beta failure criteria

The beta fails — and the AHP spike, managed sessions, and control surfaces do
**not** proceed — if any of the following is recorded:

- The queue stops being the first place checked when deciding what needs
  attention.
- Merge-readiness claims disagree with manual Git inspection, or gate results
  are current, stale, or failed at the wrong times.
- A transcript format change degrades agent state to `no signal` while an agent
  is clearly running, without a repair path within the test period.
- A performance target above is missed and not restored by a contract-approved
  change.
- Any code path deletes, overwrites, or cleans an archived or unregistered
  worktree.
- The operator abandons the test because the workspace is slower to use than
  the terminal it replaces.
