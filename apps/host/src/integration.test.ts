import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { WORKSPACE_SCHEMA_VERSION } from '@review-workspace/schema';
import { WorkspaceStore } from './store.js';
import { WorkspaceService } from './workspace-service.js';
import {
  cleanupTemporary, git, jsonRequest, openEvents, registerUnit, repository, snapshotBody, startFixture, viewOf,
} from './test-helpers.js';

afterEach(cleanupTemporary);

describe('End-to-end integration', () => {
  it('serves a clean first run: empty workspace API and archived view on a fresh database', async () => {
    const { service, server } = await startFixture();
    try {
      const workspace = await jsonRequest(server, 'GET', '/api/v1/workspace');
      expect(workspace.status).toBe(200);
      const snapshot = JSON.parse(workspace.text) as { schemaVersion: string; workUnits: unknown[]; seq: number; status?: string };
      expect(snapshot.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
      expect(snapshot.workUnits).toEqual([]);
      expect(snapshot.seq).toBeGreaterThanOrEqual(0);
      expect(snapshot.status).toBeDefined();

      const archived = await jsonRequest(server, 'GET', '/api/v1/work-units/archived');
      expect(archived.status).toBe(200);
      expect(JSON.parse(archived.text).workUnits).toEqual([]);

      // Unmatched GET routes either 404 (no packaged assets) or fall through to
      // the SPA shell; either way they never answer with API JSON.
      expect([200, 404]).toContain((await jsonRequest(server, 'GET', '/api/v1/does-not-exist')).status);
      expect((await jsonRequest(server, 'GET', '/api/v1/work-units/missing/diff')).status).toBe(400);
    } finally {
      await server.close();
      await service.stop();
    }
  }, 30_000);

  it('registers a worktree and reports its changes in the snapshot', async () => {
    const root = await repository();
    await writeFile(path.join(root, 'value.txt'), 'feature change\n');
    const { service, server } = await startFixture();
    try {
      const unit = await registerUnit(server, root, 'Change value.txt');
      const view = viewOf(await snapshotBody(server), unit.id);
      expect(view.workUnit.lifecycle).toBe('observing');
      expect(view.workUnit.branch).toBe('feature');
      expect(view.change?.files.map((file) => file.path)).toContain('value.txt');
      expect(view.mergeReadiness.status).toBe('blocked');
    } finally {
      await server.close();
      await service.stop();
    }
  }, 30_000);

  it('archives, restores, and unregisters a work unit without touching its files', async () => {
    const root = await repository();
    await writeFile(path.join(root, 'keep.txt'), 'keep me\n');
    const { service, server } = await startFixture();
    try {
      const unit = await registerUnit(server, root);
      expect((await jsonRequest(server, 'GET', '/api/v1/workspace')).status).toBe(200);

      const archived = await jsonRequest(server, 'POST', `/api/v1/work-units/${unit.id}/archive`);
      expect(archived.status).toBe(200);
      expect(JSON.parse(archived.text).visibility).toBe('archived');
      expect((await snapshotBody(server)).workUnits.map((view) => view.workUnit.id)).not.toContain(unit.id);
      const archivedView = JSON.parse((await jsonRequest(server, 'GET', '/api/v1/work-units/archived')).text);
      expect(archivedView.workUnits.map((view: { workUnit: { id: string } }) => view.workUnit.id)).toContain(unit.id);

      const restored = await jsonRequest(server, 'POST', `/api/v1/work-units/${unit.id}/unarchive`);
      expect(restored.status).toBe(200);
      expect(JSON.parse(restored.text).visibility).toBe('active');
      expect((await snapshotBody(server)).workUnits.map((view) => view.workUnit.id)).toContain(unit.id);

      await expect(readFile(path.join(root, 'keep.txt'), 'utf8')).resolves.toBe('keep me\n');

      const removed = await jsonRequest(server, 'DELETE', `/api/v1/work-units/${unit.id}`);
      expect(removed.status).toBe(204);
      expect((await snapshotBody(server)).workUnits.map((view) => view.workUnit.id)).not.toContain(unit.id);
      await expect(readFile(path.join(root, 'keep.txt'), 'utf8')).resolves.toBe('keep me\n');
    } finally {
      await server.close();
      await service.stop();
    }
  }, 30_000);

  it('promotes a repository gate proposal to an approved gate, runs it, and reaches ready', async () => {
    const root = await repository();
    await writeFile(path.join(root, 'value.txt'), 'feature change\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'feature');
    await writeFile(path.join(root, '.review-workspace-gates.json'), JSON.stringify({
      gates: [{ name: 'Repo check', program: process.execPath, args: ['-e', 'process.exit(0)'], required: true }],
    }));
    // Commit the proposal so the worktree stays clean; an untracked file would
    // keep merge readiness blocked for a dirty worktree.
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'gate proposal');
    const { service, server } = await startFixture();
    try {
      const unit = await registerUnit(server, root);

      let view = viewOf(await snapshotBody(server), unit.id);
      expect(view.gateDefinitions).toHaveLength(0);
      expect(view.gateProposals).toHaveLength(1);
      expect(view.gateProposals[0]!.sourcePath).toBe('.review-workspace-gates.json');
      expect(view.gateProposals[0]!.proposalHash).toBeTruthy();
      expect(view.gateRuns).toHaveLength(0);

      const approved = await jsonRequest(server, 'POST', `/api/v1/work-units/${unit.id}/gates`, {
        name: 'Repo check', program: process.execPath, args: ['-e', 'process.exit(0)'], required: true,
      });
      expect(approved.status).toBe(201);
      const gate = JSON.parse(approved.text) as { id: string };

      const run = await jsonRequest(server, 'POST', `/api/v1/work-units/${unit.id}/gates/${gate.id}/run`, { force: true });
      expect(run.status).toBe(200);
      expect(JSON.parse(run.text).status).toBe('passed');

      view = viewOf(await snapshotBody(server), unit.id);
      expect(view.mergeReadiness.status).toBe('ready');
      expect(view.gateRuns[0]?.status).toBe('passed');
    } finally {
      await server.close();
      await service.stop();
    }
  }, 45_000);

  it('runs an approved gate, reports failure, and blocks readiness with the gate named', async () => {
    const root = await repository();
    await writeFile(path.join(root, 'value.txt'), 'feature change\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'feature');
    const { service, server } = await startFixture();
    try {
      const unit = await registerUnit(server, root);
      const gate = JSON.parse((await jsonRequest(server, 'POST', `/api/v1/work-units/${unit.id}/gates`, {
        name: 'Failing check', program: process.execPath, args: ['-e', 'process.exit(1)'], required: true,
      })).text) as { id: string };

      const run = await jsonRequest(server, 'POST', `/api/v1/work-units/${unit.id}/gates/${gate.id}/run`, { force: true });
      expect(JSON.parse(run.text).status).toBe('failed');
      expect(JSON.parse(run.text).exitCode).toBe(1);

      const view = viewOf(await snapshotBody(server), unit.id);
      expect(view.mergeReadiness.status).toBe('blocked');
      expect(view.mergeReadiness.reasons.join(' ')).toContain('Failing check');
      expect(view.attention.some((item) => item.kind === 'gate-failed')).toBe(true);
      expect(view.gateRuns[0]?.status).toBe('failed');
    } finally {
      await server.close();
      await service.stop();
    }
  }, 45_000);

  it('marks a passed gate result stale when the diff changes after an edit', async () => {
    const root = await repository();
    await writeFile(path.join(root, 'value.txt'), 'feature change\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'feature');
    const { service, server } = await startFixture();
    try {
      const unit = await registerUnit(server, root);
      const gate = JSON.parse((await jsonRequest(server, 'POST', `/api/v1/work-units/${unit.id}/gates`, {
        name: 'Stable check', program: process.execPath, args: ['-e', 'process.exit(0)'], required: true,
      })).text) as { id: string };
      await jsonRequest(server, 'POST', `/api/v1/work-units/${unit.id}/gates/${gate.id}/run`, { force: true });

      let view = viewOf(await snapshotBody(server), unit.id);
      expect(view.gateRuns[0]?.status).toBe('passed');
      expect(view.mergeReadiness.status).toBe('ready');

      await writeFile(path.join(root, 'value.txt'), 'a further change\n');
      await service.refresh({ worktreePaths: [root] });

      view = viewOf(await snapshotBody(server), unit.id);
      expect(view.gateRuns[0]?.status).toBe('stale');
      expect(view.mergeReadiness.status).toBe('blocked');
      expect(view.mergeReadiness.reasons.join(' ')).toContain('Stable check has no current result');
    } finally {
      await server.close();
      await service.stop();
    }
  }, 45_000);

  it('resets a reviewed marker when the reviewed file content changes', async () => {
    const root = await repository();
    await writeFile(path.join(root, 'value.txt'), 'feature change\n');
    const { service, server } = await startFixture();
    try {
      const unit = await registerUnit(server, root);
      const reviewed = await jsonRequest(server, 'POST', `/api/v1/work-units/${unit.id}/reviewed`, { files: ['value.txt'], reviewed: true });
      expect(reviewed.status).toBe(200);

      let file = viewOf(await snapshotBody(server), unit.id).change?.files.find((candidate) => candidate.path === 'value.txt');
      expect(file?.reviewed).toBe(true);

      await writeFile(path.join(root, 'value.txt'), 'changed after review\n');
      await service.refresh({ worktreePaths: [root] });

      file = viewOf(await snapshotBody(server), unit.id).change?.files.find((candidate) => candidate.path === 'value.txt');
      expect(file?.reviewed).toBe(false);
    } finally {
      await server.close();
      await service.stop();
    }
  }, 45_000);

  it('streams ordered snapshots over SSE, survives a disconnect, and resumes on reconnect', async () => {
    const root = await repository();
    const { service, server } = await startFixture();
    let unitId = '';
    const stream = await openEvents(server);
    try {
      const first = await stream.nextSnapshot();
      expect(first?.type).toBe('workspace.snapshot');

      const unit = await registerUnit(server, root);
      unitId = unit.id;
      // The start-up reconciliation may publish an event between the initial
      // snapshot and the one registration triggers, so read until the unit appears.
      let after = await stream.nextSnapshot();
      while (after && !after.snapshot.workUnits.some((view) => view.workUnit.id === unitId)) {
        after = await stream.nextSnapshot();
      }
      expect(after?.snapshot.workUnits.some((view) => view.workUnit.id === unitId)).toBe(true);
      expect(after ? after.seq : 0).toBeGreaterThan(first?.seq ?? 0);
    } finally {
      await stream.close();
    }

    // Reconnect: the subscriber immediately receives the current snapshot.
    const resumed = await openEvents(server);
    try {
      const snapshot = await resumed.nextSnapshot();
      expect(snapshot?.snapshot.workUnits.some((view) => view.workUnit.id === unitId)).toBe(true);
    } finally {
      await resumed.close();
    }

    await server.close();
    await service.stop();
  }, 45_000);

  it('degrades a worktree to unavailable when its path disappears', async () => {
    const root = await repository();
    const { service, server } = await startFixture();
    try {
      const unit = await registerUnit(server, root);
      await rm(root, { recursive: true, force: true });
      await service.refresh({ worktreePaths: [root] });

      const view = viewOf(await snapshotBody(server), unit.id);
      expect(view.workUnit.lifecycle).toBe('unavailable');
      expect(view.change).toBeNull();
      expect(view.queueTier).toBe(0);
      expect(view.attention.some((item) => item.kind === 'unavailable')).toBe(true);
    } finally {
      await server.close();
      await service.stop();
    }
  }, 45_000);

  it('survives a restart and migrates a pre-hash reviewed database in place', async () => {
    const root = await repository();
    await writeFile(path.join(root, 'value.txt'), 'feature change\n');
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-e2e-migrate-'));
    const { rm: cleanup } = await import('node:fs/promises');
    try {
      let unitId = '';
      let repositoryId = '';
      let gateId = '';
      {
        const service = new WorkspaceService(new WorkspaceStore(dataDir));
        await service.start();
        const unit = await service.register({ task: 'Persistent task', worktreePath: root, baseRef: 'main' });
        unitId = unit.id;
        repositoryId = unit.repositoryId;
        const gate = await service.addGate(unit.id, { name: 'Keep me', program: process.execPath, args: ['-e', 'process.exit(0)'] });
        gateId = gate.id;
        await service.runGate(unit.id, gate.id);
        await service.setReviewed(unit.id, { files: ['value.txt'], reviewed: true });
        await service.stop();
      }

      // Rewind the database to the pre-v2 shape: drop the reviewed-hash column.
      {
        const db = new DatabaseSync(path.join(dataDir, 'review-workspace.db'));
        db.exec('PRAGMA user_version = 1');
        db.exec('ALTER TABLE reviewed_files DROP COLUMN content_hash');
        db.close();
      }

      const restarted = new WorkspaceService(new WorkspaceStore(dataDir));
      await restarted.start();
      try {
        const unit = restarted.store.getWorkUnit(unitId);
        expect(unit?.task).toBe('Persistent task');
        expect(unit?.repositoryId).toBe(repositoryId);
        expect(restarted.store.listGateDefinitions(repositoryId).some((gate) => gate.id === gateId)).toBe(true);
        expect(restarted.store.listGateRuns(unitId)).toHaveLength(1);
        expect(restarted.store.reviewedFiles(unitId).has('value.txt')).toBe(true);

        // The legacy marker upgrades to the current hash and survives an unchanged patch.
        await restarted.refresh({ worktreePaths: [root] });
        expect(restarted.store.reviewedFiles(unitId).has('value.txt')).toBe(true);

        const db = new DatabaseSync(path.join(dataDir, 'review-workspace.db'));
        expect(Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)).toBe(2);
        db.close();
      } finally {
        await restarted.stop();
      }
    } finally {
      await cleanup(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 60_000);

  it('reviews a 500-file change and serves a bounded per-file diff', async () => {
    const root = await repository();
    const generated = path.join(root, 'dist', 'gen');
    await mkdir(generated, { recursive: true });
    for (let index = 0; index < 500; index += 1) {
      await writeFile(path.join(generated, `schema-${String(index).padStart(3, '0')}.d.ts`), `export type GenSchema${String(index).padStart(3, '0')} = unknown;\n`);
    }
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', '500 generated files');
    const { service, server } = await startFixture();
    try {
      const unit = await registerUnit(server, root, 'Generated bindings');
      const view = viewOf(await snapshotBody(server), unit.id);
      expect(view.change?.files).toHaveLength(500);

      const filePath = view.change!.files[0]!.path;
      const perFile = await jsonRequest(server, 'GET', `/api/v1/work-units/${unit.id}/diff?file=${encodeURIComponent(filePath)}`);
      expect(perFile.status).toBe(200);
      expect(perFile.text).toContain(filePath);

      const full = await jsonRequest(server, 'GET', `/api/v1/work-units/${unit.id}/diff`);
      expect(full.status).toBe(200);
      expect(full.text).toContain('diff --git');
    } finally {
      await server.close();
      await service.stop();
    }
  }, 90_000);
});
