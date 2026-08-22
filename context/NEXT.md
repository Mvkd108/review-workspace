# Next steps

1. Use the agent channel during ordinary work and judge one question: does the
   queue now tell you whether an agent is still working without opening its
   terminal? That was the gap that justified starting Phase 0b early.
2. Record every disagreement between the reported state and reality. The two
   expected failure modes are a long tool call reported as `stalled`, and a
   transcript format change reported as `no signal` while an agent is running.
3. Run the seven-day kill test described in `PHASE0A_KILL_TEST.md`. It is still
   unstarted, and it now covers both channels rather than the repo channel
   alone. Use at least ten real work units and three concurrent worktrees. The
   beta completion and failure criteria in `LAUNCH_CONTRACT.md` govern the
   verdict.
4. M5 (scalable review detail, file navigation, and diffs) is implemented: the
   five review tabs, fixed header with scrolling content, paginated and
   filterable file lists, on-demand per-file diffs with previous/next, the
   unified diff as a secondary view, traversal-safe per-file endpoints, and
   reviewed markers that reset when the patch changes. The next implementation
   milestone is owner-queued; run the seven-day kill test as the primary
   activity in the meantime.
5. Decide from usage whether the agent channel should stay observational.
   Control surfaces such as steering, approval, and cancellation require the AHP
   reducer spike first; that spike still has no definition in this repository.
6. Do not add managed sessions, phone access, or generated UI before step 3
   records real evidence. Starting Phase 0b early already spent the plan's
   margin once.

## Smaller follow-ups

- The GitHub repository was renamed to `Mvkd108/review-workspace` on 2026-08-22,
  matching the frozen product identity. The remaining publication action is
  reserving the `@review-workspace` npm scope, which is an owner account action.
- Cursor has no transcript to read. If its activity matters, the only observable
  surface found so far is the VS Code SQLite database, which is undocumented and
  version-fragile. Treat it as a separate spike, not a quick addition.
- M7 (agent activity reliability, UX, and privacy) is implemented: the public
  `AgentSession` no longer carries `sourcePath` (schema is now `0.4.0-beta.0`),
  the UI renders working/stalled/idle/no-signal as four distinct states with
  advisory copy, and the reader degrades to no signal on changed or unreadable
  formats. Record the stalled-threshold behavior during the kill test before
  tuning the three minutes.
- First-snapshot latency is eliminated by M2: on the reference benchmark
  dataset (twenty worktrees, five with five-hundred-file diffs) a cold start
  serves the shell in about 130 ms, the first partial in about 1.6 s, and a
  fully fresh snapshot in about 4.4 s. Re-measure with `pnpm benchmark:startup`.
- The "no diff row explosion" contract target is met by M5: the Files tab
  paginates at 100 rows and per-file diffs load on demand, so a 500-file change
  never materializes hundreds of DOM rows at once.
- New UI modules should own a directory under `apps/web/src/features/` and be
  registered in `App.tsx`, extending `src/fixtures/workspaces.ts` when a new
  contract state needs a development surface. Shared styling lives in
  `src/styles/`; feature styles stay inside their feature directory.
- The queue is attention-first by default (Needs attention). Judge in real use
  whether that default or the per-view counts need tuning; the derivation lives
  in `apps/web/src/features/workspace-queue/queueMeta.ts`.
- Bulk unarchive is not exposed: the host has single-unit unarchive only. Add it
  behind the existing `setVisibilityMany` store helper if the archived view needs
  it in practice.
- Archived units are browsable via `GET /api/v1/work-units/archived`, which
  synthesizes lightweight views without Git inspection. If an archived unit later
  needs full review evidence again, restore it first — the archived view is
  intentionally read-only and cheap.
- The "Run required checks" workflow loops over approved required gates
  client-side. If a repository carries many gates, add a host batch-run endpoint
  instead of extending the loop.
- Advisory (non-required) checks render and run, but merge readiness only reflects
  required ones. Decide from usage whether advisory failures should surface in the
  review summary's attention panel.
- Check-state and readiness derivations live in
  `apps/web/src/features/gates/gateStatus.ts`; future UI surfaces (diff gate
  badges, approval summaries) should reuse them rather than re-derive states.
