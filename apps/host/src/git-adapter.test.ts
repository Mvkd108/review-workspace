import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkUnit } from '@review-workspace/schema';
import { GitCliRepositoryAdapter } from './git-adapter.js';
import { runGit } from './process.js';

const temporary: string[] = [];

async function git(cwd: string, ...args: string[]) {
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0) throw new Error(result.stderr);
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-git-'));
  temporary.push(root);
  await git(root, 'init', '-b', 'main');
  await git(root, 'config', 'user.name', 'Review Test');
  await git(root, 'config', 'user.email', 'review@example.test');
  await writeFile(path.join(root, 'api.ts'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'api.test.ts'), 'export const tested = true;\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'base');
  await git(root, 'switch', '-c', 'feature/retry');
  return root;
}

afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('Git CLI repository adapter', () => {
  it('inspects committed and untracked changes without mutating the worktree', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'api.ts'), 'export const value = 2;\n');
    await writeFile(path.join(root, 'notes.md'), 'review me\n');
    const adapter = new GitCliRepositoryAdapter();
    const identity = await adapter.resolveIdentity(root, 'main');
    const now = new Date().toISOString();
    const workUnit: WorkUnit = {
      id: 'unit', kind: 'unmanaged', task: 'Update api.ts', repositoryId: identity.repositoryId,
      repositoryRoot: identity.repositoryRoot, worktreePath: identity.worktreePath,
      branch: identity.branch, baseRef: identity.baseRef, lifecycle: 'observing', visibility: 'active',
      scope: { allowedGlobs: [], inferredPathTokens: ['api.ts'], confirmed: false }, createdAt: now, updatedAt: now,
    };
    const inspection = await adapter.inspect(workUnit, new Set(['api.ts']));
    expect(inspection.change.dirty).toBe(true);
    expect(inspection.change.files.map((file) => file.path)).toEqual(['api.ts', 'notes.md']);
    expect(inspection.change.files.find((file) => file.path === 'api.ts')?.reviewed).toBe(true);
    expect(inspection.unifiedDiff).toContain('notes.md');
    expect(inspection.change.fingerprint).toHaveLength(64);
  });

  it('detects whether a clean committed branch merges into its base', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'api.ts'), 'export const value = 2;\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'feature');
    const adapter = new GitCliRepositoryAdapter();
    const identity = await adapter.resolveIdentity(root, 'main');
    const now = new Date().toISOString();
    const inspection = await adapter.inspect({ id: 'unit', kind: 'unmanaged', task: 'Update API', repositoryId: identity.repositoryId, repositoryRoot: identity.repositoryRoot, worktreePath: identity.worktreePath, branch: identity.branch, baseRef: 'main', lifecycle: 'observing', visibility: 'active', scope: { allowedGlobs: [], inferredPathTokens: [], confirmed: false }, createdAt: now, updatedAt: now }, new Set());
    expect(inspection.change.dirty).toBe(false);
    expect(inspection.change.ahead).toBe(1);
    expect(inspection.mergeConflict).toBe(false);
  });
});
