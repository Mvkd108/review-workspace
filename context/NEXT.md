# Next steps

1. Use the agent channel during ordinary work and judge one question: does the
   queue now tell you whether an agent is still working without opening its
   terminal? That was the gap that justified starting Phase 0b early.
2. Record every disagreement between the reported state and reality. The two
   expected failure modes are a long tool call reported as `stalled`, and a
   transcript format change reported as `unknown` while an agent is running.
3. Run the seven-day kill test described in `PHASE0A_KILL_TEST.md`. It is still
   unstarted, and it now covers both channels rather than the repo channel
   alone. Use at least ten real work units and three concurrent worktrees.
4. Decide from that usage whether the agent channel should stay observational.
   Control surfaces such as steering, approval, and cancellation require the AHP
   reducer spike first; that spike still has no definition in this repository.
5. Do not add managed sessions, phone access, or generated UI before step 3
   records real evidence. Starting Phase 0b early already spent the plan's
   margin once.

## Smaller follow-ups

- Cursor has no transcript to read. If its activity matters, the only observable
  surface found so far is the VS Code SQLite database, which is undocumented and
  version-fragile. Treat it as a separate spike, not a quick addition.
- First-snapshot latency grows with the number of registered worktrees. If it
  becomes annoying, serve a partial snapshot before the first Git pass finishes
  rather than making inspection lazy.
