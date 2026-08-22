import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RepositoryInspection } from '@review-workspace/adapter-api';
import type { WorkUnit } from '@review-workspace/schema';
import { GitCliRepositoryAdapter } from './git-adapter.js';
import { sha256 } from './hash.js';
import { runGit } from './process.js';
import { WorkspaceStore } from './store.js';
import { WorkspaceService } from './workspace-service.js';

const temporary: string[] = [];

async function git(cwd: string, ...args: string[]) {
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0) throw new Error(result.stderr);
}

async function worktrees(count: number): Promise<{ base: string; roots: string[] }> {
  const base = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-m2-base-'));
  temporary.push(base);
  await git(base, 'init', '-b', 'main');
  await git(base, 'config', 'user.name', 'Review Test');
  await git(base, 'config', 'user.email', 'review@example.test');
  await writeFile(path.join(base, 'value.txt'), 'base\n');
  await git(base, 'add', '.');
  await git(base, 'commit', '-m', 'base');

  const worktreeBase = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-m2-wts-'));
  temporary.push(worktreeBase);
  const roots: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const root = path.join(worktreeBase, `wt-${index}`);
    await git(base, 'worktree', 'add', '-b', `feature-${index}`, root);
    roots.push(root);
  }
  return { base, roots };
}

async function dataDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-m2-data-'));
  temporary.push(directory);
  return directory;
}

function cannedInspection(worktreePath: string): RepositoryInspection {
  return {
    repositoryId: `repo-${sha256(worktreePath).slice(0, 12)}`,
    repositoryRoot: worktreePath,
    branch: 'feature',
    unifiedDiff: '',
    mergeConflict: false,
    change: {
      baseCommit: 'b1c0de',
      headCommit: 'b0ba',
      branch: 'feature',
      dirty: false,
      ahead: 1,
      behind: 0,
      files: [],
      additions: 0,
      deletions: 0,
      topLevelAreas: [],
      trackedDiffHash: 'tracked',
      untrackedContentHash: 'untracked',
      fingerprint: `fp-${worktreePath}`,
      lastChangedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

class SpyGitAdapter extends GitCliRepositoryAdapter {
  calls: string[] = [];
  active = 0;
  maxConcurrent = 0;
  delayMs = 0;
  delayByPath = new Map<string, number>();
  failPaths = new Set<string>();
  private readonly memo = new Map<string, RepositoryInspection>();

  override async inspect(workUnit: WorkUnit, _reviewed: ReadonlySet<string>): Promise<RepositoryInspection> {
    const worktreePath = workUnit.worktreePath;
    this.calls.push(worktreePath);
    this.active += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
    try {
      const delay = this.delayByPath.get(worktreePath) ?? this.delayMs;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      if (this.failPaths.has(worktreePath)) throw new Error(`inspect failed for ${worktreePath}`);
      const cached = this.memo.get(worktreePath);
      if (cached) return cached;
      const inspection = cannedInspection(worktreePath);
      this.memo.set(worktreePath, inspection);
      return inspection;
    } finally {
      this.active -= 1;
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('Workspace incremental reconciliation', () => {
  it('reinspects only the worktree that changed on a filesystem event', async () => {
    const { roots } = await worktrees(3);
    const spy = new SpyGitAdapter();
    const service = new WorkspaceService(new WorkspaceStore(await dataDir()), { git: spy });
    try {
      await service.start();
      for (const root of roots) await service.register({ task: 'Task', worktreePath: root, baseRef: 'main' });
      spy.calls = [];

      await writeFile(path.join(roots[0]!, 'note.txt'), 'edited\n');
      await sleep(1_500);

      expect(spy.calls).toContain(roots[0]);
      expect(spy.calls).not.toContain(roots[1]);
      expect(spy.calls).not.toContain(roots[2]);
    } finally {
      await service.stop();
    }
  }, 20_000);

  it('does not advance the sequence on a no-op reconciliation', async () => {
    const { roots } = await worktrees(2);
    const spy = new SpyGitAdapter();
    const service = new WorkspaceService(new WorkspaceStore(await dataDir()), { git: spy });
    try {
      await service.start();
      for (const root of roots) await service.register({ task: 'Task', worktreePath: root, baseRef: 'main' });
      const before = service.current().seq;

      await service.refresh({ worktreePaths: [roots[0]!] });
      expect(service.current().seq).toBe(before);
    } finally {
      await service.stop();
    }
  }, 20_000);

  it('publishes ordered inspecting partials while a full refresh runs, then settles fresh', async () => {
    const { roots } = await worktrees(2);
    const spy = new SpyGitAdapter();
    spy.delayByPath.set(roots[1]!, 400);
    const service = new WorkspaceService(new WorkspaceStore(await dataDir()), { git: spy });
    try {
      await service.start();
      for (const root of roots) await service.register({ task: 'Task', worktreePath: root, baseRef: 'main' });

      const full = service.refresh();
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const snapshot = service.current();
        if (snapshot.status === 'inspecting') break;
        await sleep(20);
      }
      expect(service.current().status).toBe('inspecting');
      await full;
      expect(service.current().status).toBe('fresh');
    } finally {
      await service.stop();
    }
  }, 20_000);

  it('bounds Git inspection concurrency', async () => {
    const { roots } = await worktrees(8);
    const spy = new SpyGitAdapter();
    spy.delayMs = 25;
    const service = new WorkspaceService(new WorkspaceStore(await dataDir()), { git: spy });
    try {
      await service.start();
      for (const root of roots) await service.register({ task: 'Task', worktreePath: root, baseRef: 'main' });
      spy.maxConcurrent = 0;
      spy.active = 0;

      await service.refresh();
      expect(spy.maxConcurrent).toBeGreaterThan(1);
      expect(spy.maxConcurrent).toBeLessThanOrEqual(4);
    } finally {
      await service.stop();
    }
  }, 30_000);

  it('withholds readiness and marks the workspace stale while an inspection fails, then recovers', async () => {
    const { roots } = await worktrees(1);
    const root = roots[0]!;
    const spy = new SpyGitAdapter();
    const store = new WorkspaceStore(await dataDir());
    const service = new WorkspaceService(store, { git: spy });
    try {
      await service.start();
      const unit = await service.register({ task: 'Task', worktreePath: root, baseRef: 'main' });
      // A passing required gate for the exact canned fingerprint, so a healthy
      // inspection legitimately reports ready and a failure must not.
      const repositoryId = `repo-${sha256(root).slice(0, 12)}`;
      const now = new Date().toISOString();
      store.saveGateDefinition({ id: 'g1', repositoryId, name: 'Tests', program: 'node', args: [], envAllowlist: [], timeoutMs: 60_000, required: true, definitionHash: 'def-g1', approvedAt: now });
      store.saveGateRun({ id: 'r1', gateId: 'g1', workUnitId: unit.id, status: 'passed', definitionHash: 'def-g1', worktreeFingerprint: `fp-${root}`, startedAt: now, finishedAt: now, exitCode: 0, durationMs: 1, output: '' });
      await service.refresh({ worktreePaths: [root] });
      expect(service.current().status).toBe('fresh');
      expect(service.current().workUnits.find((view) => view.workUnit.id === unit.id)?.mergeReadiness.status).toBe('ready');

      spy.failPaths.add(root);
      await service.refresh({ worktreePaths: [root] });
      let snapshot = service.current();
      expect(snapshot.status).toBe('stale');
      expect(snapshot.staleReason).toMatch(/Inspection failed/);
      const degraded = snapshot.workUnits.find((view) => view.workUnit.id === unit.id);
      expect(degraded?.mergeReadiness.status).not.toBe('ready');
      expect(degraded?.mergeReadiness.status).toBe('unknown');

      spy.failPaths.delete(root);
      await service.refresh({ worktreePaths: [root] });
      snapshot = service.current();
      expect(snapshot.status).toBe('fresh');
      expect(snapshot.workUnits.find((view) => view.workUnit.id === unit.id)?.mergeReadiness.status).toBe('ready');
    } finally {
      await service.stop();
    }
  }, 20_000);
});
