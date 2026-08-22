# Session handoff — 2026-08-23 (M5: scalable review detail, file navigation, and diffs)

## Outcome

M5 made large reviews usable. The review detail pane is five tabs — Summary,
Files, Diff, Checks, Activity — with a fixed header and tab bar and an
independently scrolling content region. File lists paginate and filter, diffs
are per-file and loaded on demand, and reviewed markers are invalidated the
moment their patch changes. A 500-file work unit stays responsive and the page
height stays bounded.

## What changed (host)

- `packages/adapter-api`: `RepositoryInspection` gains `fileHashes` (per changed
  file, a hash of the content its patch is based on; not part of the public
  schema, so no schema version bump).
- `apps/host/src/git-adapter.ts`: inspection now computes per-file content
  hashes (untracked files reuse the hash computed for the fingerprint), and
  `diffForFile` extracts a single file's section from the cached unified diff by
  matching `diff --git` headers, tolerating quoted paths with spaces.
- `apps/host/src/store.ts`: database schema version 2 adds `content_hash` to
  `reviewed_files`. `setFilesReviewed` records hashes; `reconcileReviewedHashes`
  clears markers whose patch changed or that left the change set, and upgrades
  legacy markers to a baseline hash.
- `apps/host/src/workspace-service.ts`: after each inspection the service
  reconciles reviewed markers; `buildView` derives `reviewed` from the store as
  the source of truth; `setReviewed` records the current hash; `diff` reuses the
  cached inspection instead of re-inspecting; `fileDiff` serves a single changed
  file and refuses anything outside the change set (traversal-safe, never uses
  the client path on the filesystem).
- `apps/host/src/server.ts`: `GET /work-units/{id}/diff?file=<path>` returns the
  per-file diff (404 for out-of-set paths); the full diff still serves without
  the query. OpenAPI updated.

## What changed (web)

- `apps/web/src/api.ts` + `harness/StubApi.ts`: `fileDiff(id, filePath)`.
- `apps/web/src/features/review/Detail.tsx`: five tabs with a fixed header and
  scrollable content region; the Files tab opens a file into the Diff tab.
- `features/review/FilesPanel.tsx` (new): pagination (100/page) and filters by
  reviewed status, file status, directory, and risk surface (risk paths are
  collected from risk-reason details).
- `features/review/PerFileDiff.tsx` (new): per-file diff with previous/next and
  a file select, plus an explicit Unified diff secondary view.
- `review.css`: fixed-header layout, filter bar, pagination, and diff toolbar.

## Checks run

- Full typecheck: pass (schema, adapter, host, web).
- Host tests: 52 pass (3 new: reviewed-reset, marker cleared when a file leaves
  the change set, per-file endpoint with traversal refusals). Web tests: 64 pass
  (5 new review tests, 4 existing tests updated to navigate the new tabs).
- Full build and strict context check: pass.

## Acceptance evidence

- A 500-file work unit stays responsive: the Files tab paginates at 100 rows and
  the Diff tab renders one file at a time (web test).
- The page stays bounded: pagination caps the row count.
- Changing a previously reviewed file marks it unreviewed (host test, real git).
- Large diffs load on demand: per-file fetches through `?file=`; the unified diff
  is the explicit secondary view.
- No Git operation mutates the repository: per-file diffs are sliced from the
  cached inspection, and traversal attempts are refused by change-set membership.

## Exact continuation point

The next implementation milestone is owner-queued. Keep the seven-day kill test
as the primary activity, and use the smaller follow-ups in `NEXT.md` (bulk
unarchive, a batch run-required-checks endpoint, advisory-check surfacing) when
a slice is needed.
