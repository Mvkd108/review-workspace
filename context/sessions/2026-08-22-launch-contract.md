# Session handoff — 2026-08-22

## Outcome

Froze the architecture with `context/LAUNCH_CONTRACT.md`, the M0 launch
contract. This slice was documentation only; no implementation files changed.
The freeze gives every subsequent model the same definitions and a scope guard
against drift.

## What was written

- `context/LAUNCH_CONTRACT.md`: the architecture freeze.
  - Product identity: product **Review Workspace**, final repository name
    `review-workspace`, npm scope `@review-workspace`, semver with schema
    lockstep, `1.0.0` as the stable contract boundary.
  - Beta definition: a local-only review workspace for unmanaged Git worktrees.
  - Four authoritative state vocabularies, each with an unambiguous table:
    agent (`working`, `stalled`, `idle`, `no signal`), work unit (`active`,
    `archived`, `unavailable`), review (`needs attention`, `needs review`,
    `blocked`, `ready`, `clean`), and checks (`missing`, `running`, `passed`,
    `failed`, `stale`), each with its current schema mapping.
  - Worktree preservation: archived and unregistered worktrees are never
    deleted, overwritten, or cleaned by any code path.
  - Frozen performance targets: UI shell within two seconds; useful workspace
    within five seconds at approximately twenty work units; a 500-file change
    must not create hundreds of simultaneous DOM rows.
  - Explicit exclusions: agent control, LAN access, phone access, Cursor
    transcript reading, and generated UI.
  - Beta completion criteria (six) and beta failure criteria (six).
- `context/README.md`: `LAUNCH_CONTRACT.md` is now read first in the handoff
  order.
- `context/DECISIONS.md`: six new dated decisions covering identity, versioning,
  the authoritative state vocabulary, worktree preservation, performance
  targets, and exclusions.
- `context/CURRENT.md`: notes the freeze, the pending repository rename, and the
  schema-vocabulary gap.
- `context/NEXT.md`: reordered — the kill test is still first and is now judged
  by the contract's beta criteria; schema alignment with the contract vocabulary
  is a new ordered step; the repository rename is an owner follow-up.
- `scripts/check-context.mjs`: `LAUNCH_CONTRACT.md` added to the required files
  so the strict context check enforces the freeze.

## Decisions confirmed with the owner

The owner chose the final repository name `review-workspace` and the semver,
schema-locked versioning policy. The owner then renamed the GitHub repository
from `Mvkd108/GenUI-Harness` to `Mvkd108/review-workspace` on the same day; the
local `origin` remote, the package metadata, the issue template, and the live
context docs were updated to the new URL. The two earlier session notes are
historical records and were left describing the repository as it was at the
time.

## Notes on the state vocabulary

The contract names are authoritative. The schema maps cleanly for agent and
checks states, but `WorkUnitLifecycle` mixes lifecycle (`observing`,
`unavailable`) with review (`ready-for-review`, `blocked`), and the review
states `needs review` and `clean` have no single schema value. Aligning the
schema and web app with the contract vocabulary is now the fourth ordered next
step; it is deliberately out of this documentation-only slice.

## Checks run

- `pnpm context:check:strict`: pass.

## Exact continuation point

Run the seven-day kill test as the primary activity, judging it by the beta
completion and failure criteria in `LAUNCH_CONTRACT.md`, and use the agent
channel daily to record disagreements. When the schema is next touched, align
the work-unit and review state names with the contract vocabulary.
