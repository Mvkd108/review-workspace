# Session handoff — 2026-08-22 (M1: platform foundation)

## Outcome

M1 landed: storage moves out of the working directory, the database gains
versioned migrations, persisted visibility is separated from derived review
state, and archive/unarchive/bulk/archived operations complete the read and
write surface. Schema bumped to `0.3.0-beta.1`. This is the state model the
parallel web rewrite consumes.

## What changed

- `packages/workspace-schema`: `WorkUnitVisibility` (`active`/`archived`),
  `WorkUnitLifecycle` narrowed to `observing`/`unavailable`, `visibility` field
  on `WorkUnit`, version `0.3.0-beta.1`, JSON Schema + OpenAPI + contract test
  updated in lockstep.
- `apps/host/src/store.ts`: `DATABASE_SCHEMA_VERSION = 1` with `PRAGMA
  user_version` and an ordered migration list; a legacy 0.2.0 database upgrades
  in place (adds `visibility` defaulting to `active`) without data loss.
  `listWorkUnits`/`getWorkUnit` accept `includeArchived`; default lists exclude
  archived. `setVisibility`/`setVisibilityMany` and `isWithinPath` are new. A
  failed construction closes the database before throwing.
- `apps/host/src/cli-options.ts`: default data directory is the OS
  application-data directory; relative `--data-dir` resolves against `INIT_CWD`.
  Live-verified through the root `pnpm start -- --data-dir .review-live-test`
  command: the host opened its database at the repository root, not
  `apps/host`.
- `apps/host/src/server.ts`: `POST /work-units/{id}/archive`,
  `POST /work-units/{id}/unarchive`, `POST /work-units/archive` (bulk), and
  `GET /work-units/archived`.
- `apps/host/src/workspace-service.ts`: `register` sets `visibility: 'active'`;
  `buildView` derives only `observing`/`unavailable`, never review states;
  `archive`/`unarchive`/`archiveMany` added; the parallel work added `archived()`
  (lightweight views, no Git inspection) which was kept.
- Tests: new `store.test.ts` (10), new `server.test.ts` (5, including an
  archived-listing test the parallel web work added), expanded
  `cli-options.test.ts` (OS default, `INIT_CWD`), a 17-blocked-work-units
  lifecycle test, and `visibility` added to `git-adapter.test.ts` fixtures.

## Defects found while verifying

- The store constructor leaked an open SQLite handle when the
  data-dir-inside-worktree check threw, which froze Windows cleanup on the
  locked database. It now closes before throwing.
- The data-dir containment tests originally asserted the wrong direction; the
  store refuses a worktree that *contains* the data directory (ancestor or
  equal), which the tests now encode correctly.
- `pnpm start` forwards a standalone `--` into the host CLI; the parser skips it
  and relative paths resolve against `INIT_CWD` (verified live).

## Checks run

- Host typecheck: pass. Schema/adapter typecheck: pass.
- Host tests: 37 pass, including migrations, data-dir refusals, archive
  persistence across restart, the archive API, and the 17-blocked lifecycle
  case.
- Host build: pass. Strict context check: pass.
- Web typecheck is owned by the parallel rewrite and was mid-flight at handoff
  (its fixtures were reconciled to the `0.3.0-beta.1` model).

## Note on the working tree

This commit contains only the M1 slice. The parallel web rewrite under
`apps/web/` and `pnpm-lock.yaml` is intentionally left uncommitted and in
flight. Consequently the committed `apps/web` (which hardcodes
`schemaVersion: '0.2.0'`) will fail typecheck until the web rewrite lands;
the backend and schema in this commit are green.

## Exact continuation point

Run M2 (incremental refresh and startup performance) against this commit: start
the HTTP server before the first complete Git reconciliation, publish ordered
partial snapshots, reinspect only affected worktrees, coalesce watcher events,
bound inspection concurrency, and expose inspecting/fresh/stale state. The
forty-second first snapshot is the target.
