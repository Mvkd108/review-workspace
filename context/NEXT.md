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
4. Implement incremental refresh and startup performance (M2): start the HTTP
   server before the first complete Git reconciliation, publish ordered partial
   snapshots while work units are inspected, reinspect only affected worktrees,
   coalesce duplicate watcher events, bound Git-inspection concurrency, and
   expose inspecting/fresh/stale status without making readiness claims from
   stale evidence. Acceptance bar: a two-second UI shell and a five-second
   useful workspace at roughly twenty work units, with the roughly forty-second
   first snapshot eliminated.
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
- First-snapshot latency grows with the number of registered worktrees. If it
  becomes annoying, serve a partial snapshot before the first Git pass finishes
  rather than making inspection lazy. The five-second target in the launch
  contract is the acceptance bar.
- The changed-files panel renders one row per changed file. The 500-file fixture
  in `apps/web/src/fixtures` makes this visible; page or virtualize the file list
  to hold the "no diff row explosion" contract target.
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
