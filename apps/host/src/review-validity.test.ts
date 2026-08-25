import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalPath } from './paths.js';
import { runGit } from './process.js';
import { WorkspaceStore } from './store.js';
import { WorkspaceService } from './workspace-service.js';
import { startServer, type ReviewServer } from './server.js';

const temporary: string[] = [];

async function git(cwd: string, ...args: string[]) {
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0) throw new Error(result.stderr);
}

/** A worktree with a modified, deleted, added, and untracked change. */
async function changedWorktree(): Promise<string> {
  const root = canonicalPath(await mkdtemp(path.join(os.tmpdir(), 'review-workspace-rv-')));
  temporary.push(root);
  await git(root, 'init', '-b', 'main');
  await git(root, 'config', 'user.name', 'Review Test');
  await git(root, 'config', 'user.email', 'review@example.test');
  await writeFile(path.join(root, 'base.txt'), 'base\n');
  await writeFile(path.join(root, 'keep.txt'), 'keep\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'base');
  await git(root, 'switch', '-c', 'feature');
  await writeFile(path.join(root, 'base.txt'), 'base changed\n');
  await writeFile(path.join(root, 'untracked.txt'), 'untracked\n');
  await writeFile(path.join(root, 'new.txt'), 'added\n');
  await git(root, 'rm', '-q', 'keep.txt');
  return root;
}

async function dataDir(): Promise<string> {
  const directory = canonicalPath(await mkdtemp(path.join(os.tmpdir(), 'review-workspace-rv-data-')));
  temporary.push(directory);
  return directory;
}

async function startFixture(root: string): Promise<{ service: WorkspaceService; server: ReviewServer }> {
  const service = new WorkspaceService(new WorkspaceStore(await dataDir()));
  await service.start();
  const server = await startServer(service, '127.0.0.1', 0);
  await service.register({ task: 'Review changes', worktreePath: root, baseRef: 'main' });
  return { service, server };
}

async function getText(server: ReviewServer, pathname: string): Promise<{ status: number; text: string }> {
  const response = await fetch(`${server.url}${pathname}`);
  return { status: response.status, text: await response.text() };
}

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('Reviewed-file validity', () => {
  it('resets a reviewed marker when the file patch changes and clears markers for reverted files', async () => {
    const root = canonicalPath(await mkdtemp(path.join(os.tmpdir(), 'review-workspace-reset-')));
    temporary.push(root);
    await git(root, 'init', '-b', 'main');
    await git(root, 'config', 'user.name', 'Review Test');
    await git(root, 'config', 'user.email', 'review@example.test');
    await writeFile(path.join(root, 'value.txt'), 'base\n');
    await git(root, 'add', '.');
    await git(root, 'commit', '-m', 'base');
    await git(root, 'switch', '-c', 'feature');
    await writeFile(path.join(root, 'value.txt'), 'first change\n');

    const store = new WorkspaceStore(await dataDir());
    const service = new WorkspaceService(store);
    try {
      const unit = await service.register({ task: 'Change value.txt', worktreePath: root, baseRef: 'main' });
      const file = () => service.current().workUnits.find((view) => view.workUnit.id === unit.id)?.change?.files.find((candidate) => candidate.path === 'value.txt');

      await service.setReviewed(unit.id, { files: ['value.txt'], reviewed: true });
      expect(file()?.reviewed).toBe(true);
      expect(store.reviewedFiles(unit.id).has('value.txt')).toBe(true);

      await writeFile(path.join(root, 'value.txt'), 'second change\n');
      await service.refresh({ worktreePaths: [root] });
      expect(file()?.reviewed).toBe(false);
      expect(store.reviewedFiles(unit.id).has('value.txt')).toBe(false);

      // Re-reviewing the changed patch records the new baseline and survives.
      await service.setReviewed(unit.id, { files: ['value.txt'], reviewed: true });
      await service.refresh({ worktreePaths: [root] });
      expect(file()?.reviewed).toBe(true);
    } finally {
      await service.stop();
    }
  }, 20_000);

  it('clears a reviewed marker when the file disappears from the change set', async () => {
    const root = await changedWorktree();
    const store = new WorkspaceStore(await dataDir());
    const service = new WorkspaceService(store);
    try {
      const unit = await service.register({ task: 'Review', worktreePath: root, baseRef: 'main' });
      await service.setReviewed(unit.id, { files: ['untracked.txt'], reviewed: true });
      expect(store.reviewedFiles(unit.id).has('untracked.txt')).toBe(true);

      await writeFile(path.join(root, 'untracked.txt'), ''); // empty -> still present
      await git(root, 'add', 'untracked.txt');
      await git(root, 'commit', '-m', 'promote untracked');
      await service.refresh({ worktreePaths: [root] });
      expect(store.reviewedFiles(unit.id).has('untracked.txt')).toBe(false);
    } finally {
      await service.stop();
    }
  }, 20_000);
});

describe('Per-file diff endpoint', () => {
  it('serves a single changed file diff and refuses anything outside the change set', async () => {
    const root = await changedWorktree();
    const { service, server } = await startFixture(root);
    try {
      const unit = service.current().workUnits[0]!.workUnit;
      const paths = service.current().workUnits[0]!.change!.files.map((file) => file.path);
      expect(paths).toEqual(expect.arrayContaining(['base.txt', 'keep.txt', 'new.txt', 'untracked.txt']));

      for (const filePath of ['base.txt', 'keep.txt', 'new.txt', 'untracked.txt']) {
        const result = await getText(server, `/api/v1/work-units/${unit.id}/diff?file=${encodeURIComponent(filePath)}`);
        expect(result.status).toBe(200);
        expect(result.text).toContain(filePath);
      }

      // Traversal and out-of-set requests are refused.
      for (const filePath of ['../secret.txt', '..%2Fsecret.txt', path.join(os.tmpdir(), 'outside.txt'), 'missing.txt']) {
        const result = await getText(server, `/api/v1/work-units/${unit.id}/diff?file=${encodeURIComponent(filePath)}`);
        expect(result.status).toBe(404);
      }

      // The full unified diff still serves without a file query.
      const full = await getText(server, `/api/v1/work-units/${unit.id}/diff`);
      expect(full.status).toBe(200);
      expect(full.text).toContain('diff --git');
    } finally {
      await server.close();
      await service.stop();
    }
  }, 20_000);
});
