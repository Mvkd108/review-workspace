# Session handoff — 2026-08-25

## Outcome

Committed and pushed the outstanding M7/M8 work, then fixed a Windows path
defect that CI surfaced on `main`. No launch was performed: the owner chose to
push and harden now and launch after the kill test completes.

## Context for the decision

The owner asked for a launchable product within a few hours. The blocking fact
is `LAUNCH_CONTRACT.md` beta completion criterion 1: seven consecutive days of
recorded kill-test exposure. Day 1 is 2026-08-24 and today is day 2, so beta
completion cannot be claimed before 2026-08-30 regardless of engineering effort,
and the kill-test log carries an explicit anti-fabrication rule.

Read precisely, the contract gates *advancing past* the beta — the failure
criteria say the AHP spike, managed sessions, and control surfaces do not
proceed — rather than gating publication of a labelled beta. Publishing early
was therefore available and was declined in favour of hardening.

The `@review-workspace` npm scope was checked and is unclaimed; both
`@review-workspace/host` and `@review-workspace/schema` return 404.

## Work committed before the fix

Roughly thirty files of finished M7 and M8 work were sitting untracked, along
with kill-test day 1. All of it now committed as `9e35848` and pushed. This was
the largest immediate risk in the repository.

## The defect CI found

`main` went red on Windows only; Linux passed. Nine failures, one root cause.

Windows exposes a directory under both an 8.3 short alias and its long form, and
GitHub's Windows runners return the alias from `os.tmpdir()`
(`C:\Users\RUNNER~1\...`). `path.resolve` preserves whichever spelling it is
handed, while `git rev-parse --show-toplevel` returns the long form. The two
therefore compared unequal for the same directory.

Two real consequences, not merely test artifacts:

- `isWithinPath` answered "not contained", so the guard that refuses to place the
  host database inside an observed worktree **failed open**. This is the guard
  `SECURITY.md` describes as protecting the data directory, and the failing
  assertion was literally `expected 201 to be 400`.
- `repositoryId` is a hash of the Git common directory, so one repository reached
  by two spellings took two identities. Gate definitions are keyed by
  `repositoryId`, so approved gates would silently orphan.

## The fix

New `apps/host/src/paths.ts` provides `canonicalPath`, `comparablePath`, and
`isWithinPath`, resolving through `realpathSync.native` — the native resolver is
required, because Node's JavaScript `realpath` walks symlinks but does not expand
a short name. A path that does not exist is returned resolved rather than
throwing, since an unavailable worktree is a normal state.

`store.ts` now re-exports the shared helper instead of defining its own,
`git-adapter.ts` canonicalises before deriving identity, and the agent channel's
`isWithin` delegates to the same helper so a session whose reported working
directory is spelled differently still binds to its worktree.

`.toLowerCase()` was deliberately retained for the `repositoryId` hash. Existing
databases on the operator's machine already hold long, canonical paths, so the
derived identity is unchanged there and the running kill test keeps its
registrations and gates.

Five regression tests in `paths.test.ts` cover indirect resolution, a missing
path, containment across mixed spellings, sibling directories sharing a name
prefix, and the platform-specific casing rule.

## Checks

- Host suite: 77 tests across 12 files pass locally, up from 72.
- Typecheck passes. Full verification and CI confirmation follow the commit.

## Exact continuation point

Record kill-test day 2 from real usage today. Criterion 3 of the launch contract
remains partly unmet and is the next hardening target: the user-facing vocabulary
already matches the contract, but the schema names still do not — `lifecycle`
uses `observing` where the contract says `active`, `AgentActivityState` uses
`unknown` where the contract says `no signal`, and `GateRunStatus` keeps a
separate `error` the contract treats as a subcase of `failed`. Nothing is
published yet, so renaming is cheapest now; it is a breaking schema change and
must bump the version alongside the JSON Schema, OpenAPI document, and contract
test in one commit.
