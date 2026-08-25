import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceStore } from './store.js';
import { WorkspaceService } from './workspace-service.js';
import {
  cleanupTemporary, git, jsonRequest, rawRequest, registerUnit, repository, snapshotBody, startFixture, viewOf,
} from './test-helpers.js';

afterEach(cleanupTemporary);

async function failingAccess(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, 'utf8');
    return true;
  } catch {
    return false;
  }
}

describe('Negative security tests', () => {
  it('echoes loopback origins but never cross-origin callers', async () => {
    const { service, server } = await startFixture();
    try {
      const loopback = await rawRequest(server, 'GET', '/api/v1/workspace', { headers: { origin: 'http://127.0.0.1:9999' } });
      expect(loopback.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:9999');

      const localhost = await rawRequest(server, 'GET', '/api/v1/workspace', { headers: { origin: 'http://localhost:4317' } });
      expect(localhost.headers.get('access-control-allow-origin')).toBe('http://localhost:4317');

      const httpsLoopback = await rawRequest(server, 'GET', '/api/v1/workspace', { headers: { origin: 'https://127.0.0.1:1' } });
      expect(httpsLoopback.headers.get('access-control-allow-origin')).toBe('https://127.0.0.1:1');

      const evil = await rawRequest(server, 'GET', '/api/v1/workspace', { headers: { origin: 'http://evil.example' } });
      expect(evil.headers.get('access-control-allow-origin')).toBeNull();

      const rebinding = await rawRequest(server, 'GET', '/api/v1/workspace', { headers: { origin: 'http://127.0.0.1.evil.example' } });
      expect(rebinding.headers.get('access-control-allow-origin')).toBeNull();

      const evilScheme = await rawRequest(server, 'GET', '/api/v1/workspace', { headers: { origin: 'file:///tmp/steal' } });
      expect(evilScheme.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await server.close();
      await service.stop();
    }
  }, 30_000);

  it('answers preflight for loopback origins only', async () => {
    const { service, server } = await startFixture();
    try {
      const ok = await rawRequest(server, 'OPTIONS', '/api/v1/work-units', {
        headers: { origin: 'http://127.0.0.1:4317', 'access-control-request-method': 'POST' },
      });
      expect(ok.status).toBe(204);
      expect(ok.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:4317');
      expect(ok.headers.get('access-control-allow-methods')).toContain('POST');

      const bad = await rawRequest(server, 'OPTIONS', '/api/v1/work-units', {
        headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' },
      });
      expect(bad.status).toBe(204);
      expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await server.close();
      await service.stop();
    }
  }, 30_000);

  it('never serves files outside the packaged web root through the static handler', async () => {
    const { service, server } = await startFixture();
    try {
      // A marker that exists only in the real, packaged workspace schema document.
      const marker = 'https://review-workspace.dev/schema';
      const attempts = [
        '/%2e%2e/workspace.schema.json',
        '/..%2f..%2f..%2f..%2fetc%2fpasswd',
        '/..%2F..%2Fworkspace.schema.json',
        '/%2e%2e%2fworkspace.schema.json',
        '/..%5c..%5cworkspace.schema.json',
        '/..%5C..%5C..%5C..%5Cetc%5Cpasswd',
      ];
      for (const attempt of attempts) {
        const response = await rawRequest(server, 'GET', attempt);
        expect(response.text).not.toContain(marker);
        expect(response.text).not.toContain('BEGIN RSA PRIVATE KEY');
        expect(response.text).not.toContain('review-workspace.db');
      }
    } finally {
      await server.close();
      await service.stop();
    }
  }, 30_000);

  it('refuses work-unit ids that attempt path traversal on API routes', async () => {
    const { service, server } = await startFixture();
    try {
      const diff = await rawRequest(server, 'GET', '/api/v1/work-units/..%2F..%2Fetc%2Fpasswd/diff');
      expect([400, 404]).toContain(diff.status);
      expect(diff.text).not.toContain('BEGIN RSA PRIVATE KEY');

      const remove = await rawRequest(server, 'DELETE', '/api/v1/work-units/..%2F..%2F..%2Fstore');
      expect([400, 404]).toContain(remove.status);

      const archive = await rawRequest(server, 'POST', '/api/v1/work-units/..%2F..%2Fconfig/archive');
      expect([400, 404]).toContain(archive.status);
    } finally {
      await server.close();
      await service.stop();
    }
  }, 30_000);

  it('never executes a repository gate proposal until it is approved', async () => {
    const root = await repository();
    const marker = path.join(root, 'MARKER_EXECUTED');
    const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`;
    await writeFile(path.join(root, '.review-workspace-gates.json'), JSON.stringify({
      gates: [{ name: 'Sneaky check', program: process.execPath, args: ['-e', script], required: true }],
    }));
    const { service, server } = await startFixture();
    try {
      const unit = await registerUnit(server, root);
      const view = viewOf(await snapshotBody(server), unit.id);
      expect(view.gateProposals).toHaveLength(1);
      expect(view.gateDefinitions).toHaveLength(0);
      expect(view.gateRuns).toHaveLength(0);

      // A full reconciliation and an agent-only pass must not run the proposal.
      await service.refresh();
      await service.refresh({ agentOnly: true });
      expect(await failingAccess(marker)).toBe(false);

      // Running a gate that was never approved is an error.
      const run = await jsonRequest(server, 'POST', `/api/v1/work-units/${unit.id}/gates/not-approved/run`, { force: true });
      expect(run.status).toBe(400);
      expect(run.text).toContain('Trusted gate not found');
    } finally {
      await server.close();
      await service.stop();
    }
  }, 45_000);

  it('exposes no transcript content, tool output, or path through the snapshot API', async () => {
    const root = await repository();
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-fake-home-'));
    try {
      const projects = path.join(fakeHome, '.claude', 'projects', 'proj');
      const codex = path.join(fakeHome, '.codex', 'sessions', '2026', '08', '23');
      await mkdir(projects, { recursive: true });
      await mkdir(codex, { recursive: true });

      const pastedSecret = 'PASTED_SECRET_CREDENTIAL';
      const toolOutputSecret = 'TOOL_OUTPUT_SECRET';
      const claude = [
        { type: 'user', cwd: root, sessionId: 'sess-claude', message: { role: 'user', content: [{ type: 'text', text: pastedSecret }] } },
        { type: 'assistant', cwd: root, sessionId: 'sess-claude', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'cat .env' }, tool_use_id: 't1' }], stop_reason: 'tool_use' } },
      ];
      await writeFile(path.join(projects, 'sess-claude.jsonl'), claude.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
      const codexEntries = [
        { type: 'session_meta', payload: { session_id: 'sess-codex', cwd: root } },
        { type: 'event_msg', payload: { type: 'task_started' } },
        { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: toolOutputSecret } },
      ];
      await writeFile(path.join(codex, 'rollout-codex.jsonl'), codexEntries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');

      const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
      process.env.HOME = fakeHome;
      process.env.USERPROFILE = fakeHome;
      const dataDir = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-leak-data-'));
      let service: WorkspaceService | undefined;
      try {
        service = new WorkspaceService(new WorkspaceStore(dataDir));
        await service.start();
        await service.register({ task: 'Observed', worktreePath: root, baseRef: 'main' });
        await service.refresh();

        const serialized = JSON.stringify(service.current());
        expect(serialized).not.toContain(pastedSecret);
        expect(serialized).not.toContain(toolOutputSecret);
        expect(serialized).not.toContain('sess-claude.jsonl');
        expect(serialized).not.toContain('.claude');
        expect(serialized).not.toContain('.codex');
        expect(serialized).not.toContain('sourcePath');
        expect(serialized).not.toContain('function_call_output');

        const view = service.current().workUnits[0];
        expect(view?.agentActivity.sessions.length).toBeGreaterThan(0);
        for (const session of view?.agentActivity.sessions ?? []) {
          expect(Object.keys(session).sort()).toEqual(['agentLabel', 'cwd', 'lastActivityAt', 'lastTurnComplete', 'sessionId', 'state']);
        }
      } finally {
        process.env.HOME = previous.HOME;
        process.env.USERPROFILE = previous.USERPROFILE;
        await service?.stop();
        await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    } finally {
      await rm(fakeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 45_000);

  it('refuses to register a worktree that encloses the host data directory', async () => {
    const root = await repository();
    const dataDir = path.join(root, 'host-data');
    const service = new WorkspaceService(new WorkspaceStore(dataDir));
    await service.start();
    const { startServer } = await import('./server.js');
    const server = await startServer(service, '127.0.0.1', 0);
    try {
      const response = await jsonRequest(server, 'POST', '/api/v1/work-units', { task: 'X', worktreePath: root, baseRef: 'main' });
      expect(response.status).toBe(400);
      expect(response.text).toContain('data directory');
    } finally {
      await server.close();
      await service.stop();
    }
  }, 30_000);

  it('refuses to open a data directory that lives inside an already-registered worktree', async () => {
    const root = await repository();
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-elsewhere-'));
    try {
      const store = new WorkspaceStore(elsewhere);
      store.saveWorkUnit({
        id: 'unit-1', kind: 'unmanaged', task: 'X', repositoryId: 'repo', repositoryRoot: root, worktreePath: root,
        branch: 'feature', baseRef: 'main', lifecycle: 'observing', visibility: 'active',
        scope: { allowedGlobs: [], inferredPathTokens: [], confirmed: false }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      store.close();

      const moved = path.join(root, 'host-data');
      await mkdir(moved, { recursive: true });
      await copyFile(path.join(elsewhere, 'review-workspace.db'), path.join(moved, 'review-workspace.db'));
      expect(() => new WorkspaceStore(moved)).toThrow(/inside observed worktree/);
    } finally {
      await rm(elsewhere, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 30_000);

  it('rejects request bodies over one megabyte', async () => {
    const { service, server } = await startFixture();
    try {
      const response = await rawRequest(server, 'POST', '/api/v1/work-units', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task: 'x', worktreePath: '/tmp/nope', padding: 'a'.repeat(1_100_000) }),
      });
      expect(response.status).toBe(400);
      expect(response.text).toContain('too large');
    } finally {
      await server.close();
      await service.stop();
    }
  }, 30_000);
});
