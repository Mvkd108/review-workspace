import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceSnapshot } from '@review-workspace/schema';
import { runGit } from './process.js';
import { WorkspaceStore } from './store.js';
import { WorkspaceService } from './workspace-service.js';
import { startServer, type ReviewServer } from './server.js';

const temporary: string[] = [];

async function git(cwd: string, ...args: string[]) {
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0) throw new Error(result.stderr);
}

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-api-'));
  temporary.push(root);
  await git(root, 'init', '-b', 'main');
  await git(root, 'config', 'user.name', 'Review Test');
  await git(root, 'config', 'user.email', 'review@example.test');
  await writeFile(path.join(root, 'value.txt'), 'base\n');
  await git(root, 'add', '.'); await git(root, 'commit', '-m', 'base'); await git(root, 'switch', '-c', 'feature');
  return root;
}

async function startFixture(dataDir?: string): Promise<{ service: WorkspaceService; server: ReviewServer; dataDir: string }> {
  if (!dataDir) {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-api-data-'));
    temporary.push(dataDir);
  }
  const service = new WorkspaceService(new WorkspaceStore(dataDir));
  await service.start();
  const server = await startServer(service, '127.0.0.1', 0);
  return { service, server, dataDir };
}

async function secondWorktree(base: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-api-wt-'));
  temporary.push(root);
  await git(base, 'worktree', 'add', '-b', 'feature-two', root);
  return root;
}

async function request(server: ReviewServer, method: string, pathname: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${server.url}${pathname}`, init);
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

async function snapshotIds(server: ReviewServer): Promise<string[]> {
  const snapshot = (await request(server, 'GET', '/api/v1/workspace')).body as unknown as WorkspaceSnapshot;
  return snapshot.workUnits.map((view) => view.workUnit.id);
}

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('Work unit archive API', () => {
  it('archives a work unit, hides it from the snapshot, and restores it on unarchive', async () => {
    const root = await repository();
    const { service, server } = await startFixture();
    try {
      const registered = (await request(server, 'POST', '/api/v1/work-units', {
        task: 'Change value.txt', worktreePath: root, baseRef: 'main',
      })).body as { id: string };
      expect(registered?.id).toBeTruthy();
      expect(await snapshotIds(server)).toContain(registered.id);

      const archived = (await request(server, 'POST', `/api/v1/work-units/${registered.id}/archive`));
      expect(archived.status).toBe(200);
      expect(archived.body?.visibility).toBe('archived');
      expect(await snapshotIds(server)).not.toContain(registered.id);

      const restored = (await request(server, 'POST', `/api/v1/work-units/${registered.id}/unarchive`));
      expect(restored.status).toBe(200);
      expect(restored.body?.visibility).toBe('active');
      expect(await snapshotIds(server)).toContain(registered.id);
    } finally {
      await server.close();
      await service.stop();
    }
  }, 15_000);

  it('returns 404 for an unknown or already archived work unit', async () => {
    const root = await repository();
    const { service, server } = await startFixture();
    try {
      expect((await request(server, 'POST', '/api/v1/work-units/missing/archive')).status).toBe(404);

      const registered = (await request(server, 'POST', '/api/v1/work-units', {
        task: 'Change value.txt', worktreePath: root, baseRef: 'main',
      })).body as { id: string };
      await request(server, 'POST', `/api/v1/work-units/${registered.id}/archive`);
      expect((await request(server, 'POST', `/api/v1/work-units/${registered.id}/archive`)).status).toBe(404);
    } finally {
      await server.close();
      await service.stop();
    }
  }, 15_000);

  it('bulk-archives several work units and hides them all', async () => {
    const root = await repository();
    const second = await secondWorktree(root);
    const { service, server } = await startFixture();
    try {
      const firstUnit = (await request(server, 'POST', '/api/v1/work-units', { task: 'One', worktreePath: root, baseRef: 'main' })).body as { id: string };
      const secondUnit = (await request(server, 'POST', '/api/v1/work-units', { task: 'Two', worktreePath: second, baseRef: 'main' })).body as { id: string };
      expect(await snapshotIds(server)).toContain(firstUnit.id);
      expect(await snapshotIds(server)).toContain(secondUnit.id);

      const bulk = (await request(server, 'POST', '/api/v1/work-units/archive', { ids: [firstUnit.id, secondUnit.id, 'missing'] }));
      expect(bulk.status).toBe(200);
      expect(bulk.body?.archived).toEqual([firstUnit.id, secondUnit.id]);
      expect(await snapshotIds(server)).not.toContain(firstUnit.id);
      expect(await snapshotIds(server)).not.toContain(secondUnit.id);

      expect((await request(server, 'POST', '/api/v1/work-units/archive', { ids: [] })).status).toBe(400);
    } finally {
      await server.close();
      await service.stop();
    }
  }, 15_000);

  it('lists archived work units through the archived endpoint, and only archived ones', async () => {
    const root = await repository();
    const second = await secondWorktree(root);
    const { service, server } = await startFixture();
    try {
      const active = (await request(server, 'POST', '/api/v1/work-units', { task: 'Active task', worktreePath: root, baseRef: 'main' })).body as { id: string };
      const keep = (await request(server, 'POST', '/api/v1/work-units', { task: 'Keep task', worktreePath: second, baseRef: 'main' })).body as { id: string };
      await request(server, 'POST', `/api/v1/work-units/${active.id}/archive`);

      const archived = (await request(server, 'GET', '/api/v1/work-units/archived')).body as unknown as WorkspaceSnapshot;
      expect(archived.workUnits.map((view) => view.workUnit.id)).toEqual([active.id]);
      expect(archived.workUnits[0]?.workUnit.visibility).toBe('archived');
      expect(archived.workUnits[0]?.mergeReadiness.status).toBe('unknown');
      expect(archived.workUnits.some((view) => view.workUnit.id === keep.id)).toBe(false);
    } finally {
      await server.close();
      await service.stop();
    }
  }, 15_000);

  it('survives a restart: an archived unit stays hidden after reopen', async () => {
    const root = await repository();
    const first = await startFixture();
    let id: string;
    try {
      id = ((await request(first.server, 'POST', '/api/v1/work-units', { task: 'Change value.txt', worktreePath: root, baseRef: 'main' })).body as { id: string }).id;
      await request(first.server, 'POST', `/api/v1/work-units/${id}/archive`);
      expect(await snapshotIds(first.server)).not.toContain(id);
    } finally {
      await first.server.close();
      await first.service.stop();
    }

    const restarted = await startFixture(first.dataDir);
    try {
      expect(await snapshotIds(restarted.server)).not.toContain(id);
      const restored = (await request(restarted.server, 'POST', `/api/v1/work-units/${id}/unarchive`));
      expect(restored.status).toBe(200);
      expect(await snapshotIds(restarted.server)).toContain(id);
    } finally {
      await restarted.server.close();
      await restarted.service.stop();
    }
  }, 20_000);
});
