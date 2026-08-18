import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runGit } from './process.js';
import { WorkspaceStore } from './store.js';
import { WorkspaceService } from './workspace-service.js';

const temporary: string[] = [];
async function git(cwd: string, ...args: string[]) { const result = await runGit(cwd, args); if (result.exitCode !== 0) throw new Error(result.stderr); }

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-service-'));
  temporary.push(root);
  await git(root, 'init', '-b', 'main');
  await git(root, 'config', 'user.name', 'Review Test');
  await git(root, 'config', 'user.email', 'review@example.test');
  await writeFile(path.join(root, 'value.txt'), 'base\n');
  await git(root, 'add', '.'); await git(root, 'commit', '-m', 'base'); await git(root, 'switch', '-c', 'feature');
  return root;
}

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('Workspace service gate trust', () => {
  it('reuses a result for an unchanged fingerprint and marks it stale after a change', async () => {
    const root = await repository();
    const data = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-data-')); temporary.push(data);
    const service = new WorkspaceService(new WorkspaceStore(data));
    try {
      const unit = await service.register({ task: 'Change value.txt', worktreePath: root, baseRef: 'main', agentLabel: 'codex' });
      const gate = await service.addGate(unit.id, { name: 'Passing check', program: process.execPath, args: ['-e', 'process.exit(0)'], required: true });
      const first = await service.runGate(unit.id, gate.id, false);
      const same = await service.runGate(unit.id, gate.id, false);
      expect(same.id).toBe(first.id);
      await writeFile(path.join(root, 'value.txt'), 'changed\n');
      const next = await service.runGate(unit.id, gate.id, false);
      expect(next.id).not.toBe(first.id);
      expect(next.worktreeFingerprint).not.toBe(first.worktreeFingerprint);
    } finally {
      await service.stop();
    }
  }, 15_000);

  it('treats repository gate files as hash-stamped proposals until approved', async () => {
    const root = await repository();
    await writeFile(path.join(root, '.review-workspace-gates.json'), JSON.stringify({ gates: [{ name: 'Repo tests', program: process.execPath, args: ['-e', 'process.exit(0)'], required: true }] }));
    const data = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-proposal-')); temporary.push(data);
    const service = new WorkspaceService(new WorkspaceStore(data));
    try {
      const unit = await service.register({ task: 'Change value.txt', worktreePath: root, baseRef: 'main' });
      const view = service.current().workUnits[0];
      expect(view?.gateDefinitions).toHaveLength(0);
      expect(view?.gateProposals).toHaveLength(1);
      const proposal = view?.gateProposals[0];
      expect(proposal?.sourcePath).toBe('.review-workspace-gates.json');
      const approved = await service.addGate(unit.id, proposal!);
      expect(approved.definitionHash).toBe(proposal?.proposalHash);
    } finally {
      await service.stop();
    }
  }, 15_000);
});
