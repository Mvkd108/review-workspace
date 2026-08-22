import type { WorkUnitView, WorkspaceSnapshot } from '@review-workspace/schema';
import type { ApiLike } from '../api';
import type { Fixture } from '../fixtures/workspaces';

/** An in-memory ApiLike that serves a fixture snapshot and mutates on archive. */
export function stubApi(fixture: Fixture, options?: { failWorkspace?: boolean }): ApiLike {
  const makeSnapshot = (views: WorkUnitView[]): WorkspaceSnapshot => ({ ...fixture.snapshot, workUnits: [...views] });
  const activeUnits = fixture.snapshot.workUnits.filter((view) => view.workUnit.visibility !== 'archived');
  const archivedUnits = fixture.snapshot.workUnits.filter((view) => view.workUnit.visibility === 'archived');

  function move(ids: string[], target: WorkUnitView['workUnit']['visibility']) {
    const source = target === 'archived' ? activeUnits : archivedUnits;
    const destination = target === 'archived' ? archivedUnits : activeUnits;
    for (const id of ids) {
      const index = source.findIndex((view) => view.workUnit.id === id);
      if (index >= 0) {
        const [view] = source.splice(index, 1);
        if (view) destination.push({ ...view, workUnit: { ...view.workUnit, visibility: target } });
      }
    }
  }

  return {
    workspace: async () => {
      if (options?.failWorkspace) throw new Error('Simulated workspace failure.');
      return makeSnapshot(activeUnits);
    },
    archived: async () => makeSnapshot(archivedUnits),
    register: async () => { throw new Error('The fixture harness is read-only.'); },
    unregister: async (id) => {
      const remove = (list: WorkUnitView[]) => list.filter((view) => view.workUnit.id !== id);
      activeUnits.splice(0, activeUnits.length, ...remove(activeUnits));
      archivedUnits.splice(0, archivedUnits.length, ...remove(archivedUnits));
    },
    archive: async (id) => { move([id], 'archived'); return {}; },
    unarchive: async (id) => { move([id], 'active'); return {}; },
    archiveMany: async (ids) => { move(ids, 'archived'); return { archived: ids }; },
    diff: async () => fixture.diff ?? '',
    fileDiff: async (_id, filePath) => {
      const full = fixture.diff ?? '';
      const section = full.split(/\n(?=diff --git )/).find((candidate) => candidate.includes(filePath));
      return section ?? `diff --git a/${filePath} b/${filePath}\n@@ -1,1 +1,1 @@\n+change to ${filePath}\n`;
    },
    addGate: async () => ({}),
    runGate: async (id, gateId) => ({ id: 'fixture-run', gateId, workUnitId: id, status: 'running', definitionHash: 'fixture', worktreeFingerprint: 'fixture', startedAt: new Date().toISOString(), output: '' }),
    removeGate: async () => undefined,
    setReviewed: async () => ({}),
    events: (_onEvent, onState) => { onState(true); return () => {}; },
  };
}
