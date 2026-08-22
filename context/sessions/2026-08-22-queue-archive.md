# Session handoff — 2026-08-22 (M4 queue, filtering, grouping, archive, onboarding)

## Outcome

Made the workspace useful with many historical and parallel work units: compact
queue rows grouped by repository, five operator views with counts, keyboard
search, archive/unarchive plus bulk archive, first-run onboarding, and per-view
empty states. Archived work is hidden by default and browsable through a new
read endpoint. `QueueCard` was replaced by `QueueRow`; the big sidebar cards are
gone.

## What was written

Web (`apps/web/src/features/workspace-queue/` plus registration):

- `queueMeta.ts`: pure derivations — view membership (attention, progress, ready,
  active, archived), search matching (task, branch, repo, agent, file paths),
  repository grouping, and one primary state + one recommended action per row.
- `QueueRow.tsx`: compact two-line row (state pill, task, time, recommended
  action, branch, file count) with per-row archive/restore and bulk checkboxes.
- `QueuePane.tsx`: toolbar with search and view buttons carrying counts, grouped
  list, per-view empty states, first-run onboarding, and a bulk-archive bar.
- `queue.css`: rewritten for compact rows, repository groups, and the toolbar.
- `App.tsx`: holds view/query/archived-snapshot state; loads archived on mount;
  archive/restore/bulk-archive handlers refresh both the active and archived
  snapshots; selection works across the combined list.
- `Detail.tsx`: Archive/Restore action for the selected unit; Unregister stays
  explicit ("Its worktree and files are not changed or deleted"); archived units
  render a read-only summary instead of action panels.
- `RegistrationForm.tsx`: onboarding copy makes clear the workspace is read-only
  and that archive/unregister never touch the files.
- `Icon.tsx`: added `search` and `archive`.
- `fixtures/workspaces.ts`: `buildView` gained repository/path/date options and a
  new **19 work units across repositories** fixture (16 active, 3 archived,
  3 repos) that exercises grouping, counts, search, and archive.
- `StubApi.ts`: mutable in-memory api with working archive/unarchive/bulk; each
  snapshot returns a fresh array so memoized queue state recomputes.

Host (minimal, additive — the read path M4 needed): `WorkspaceService.archived()`
builds lightweight views for archived registrations with no Git inspection, and
`GET /api/v1/work-units/archived` serves them. `server.test.ts` gained a test for
that endpoint.

## Checks run

- `pnpm --filter @review-workspace/web typecheck`: pass.
- `pnpm --filter @review-workspace/web test`: 36 tests pass (App render/error/
  loading/selection, view filtering, search, counts, archive/restore/bulk, diff
  tab, registration dialog, queueMeta derivations, fixtures, harness).
- `pnpm --filter @review-workspace/web build`: pass.
- `pnpm --filter @review-workspace/host typecheck` and `test`: pass (37 tests,
  including the archived-endpoint test).
- `pnpm typecheck` (all packages) and `pnpm context:check:strict`: pass.

## Notes and follow-ups

- The queue is now attention-first by default. "Needs attention" derives from
  attention kinds that demand the operator; informational items (ready-for-review,
  agent-working) are excluded. Activity never feeds merge readiness.
- Bulk unarchive is not exposed: the host has a single-unit unarchive. Add
  `setVisibilityMany(..., 'active')` behind an endpoint only if the archived view
  needs it in practice.
- The changed-files panel still renders one row per changed file; paging or
  virtualization is still an open follow-up for the "no diff row explosion"
  contract target.
- M4 ran parallel to M1 (host archive/visibility). The only host files touched
  here are the additive archived read endpoint, its route, and its test.

## Exact continuation point

Run the seven-day kill test as the primary activity. For the web app, use the
`?harness` page with the 19-unit fixture to judge whether the grouped queue and
per-view counts hold up in real use; extend `fixtures/workspaces.ts` when a new
contract state needs a development surface.
