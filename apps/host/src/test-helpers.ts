import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WorkUnit, WorkspaceSnapshot } from '@review-workspace/schema';
import { canonicalPath } from './paths.js';
import { runGit } from './process.js';
import { WorkspaceStore } from './store.js';
import { WorkspaceService } from './workspace-service.js';
import { startServer, type ReviewServer } from './server.js';

export const temporary: string[] = [];

export async function cleanupTemporary(): Promise<void> {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export async function git(cwd: string, ...args: string[]): Promise<void> {
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0) throw new Error(result.stderr);
}

/** A repository on `main` with a base commit, switched to a fresh `feature` branch. */
/**
 * A temporary directory in the canonical spelling the host will use.
 *
 * `os.tmpdir()` reads %TEMP%, which on Windows is often an 8.3 short alias —
 * GitHub's runners report `C:\Users\RUNNER~1\...`. The host canonicalises every
 * path it stores, so a fixture that kept the short form would compare unequal to
 * its own registration and the test would be asserting against a spelling the
 * product never produces. Always create fixture roots through this.
 */
export async function temporaryRoot(prefix: string): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporary.push(created);
  return canonicalPath(created);
}

export async function repository(): Promise<string> {
  const root = await temporaryRoot('review-workspace-e2e-');
  await git(root, 'init', '-b', 'main');
  await git(root, 'config', 'user.name', 'Review Test');
  await git(root, 'config', 'user.email', 'review@example.test');
  await writeFile(path.join(root, 'value.txt'), 'base\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'base');
  await git(root, 'switch', '-c', 'feature');
  return root;
}

export async function dataDirectory(): Promise<string> {
  return temporaryRoot('review-workspace-e2e-data-');
}

export async function startFixture(dataDir?: string): Promise<{ service: WorkspaceService; server: ReviewServer; dataDir: string }> {
  const resolved = dataDir ?? await dataDirectory();
  const service = new WorkspaceService(new WorkspaceStore(resolved));
  await service.start();
  const server = await startServer(service, '127.0.0.1', 0);
  return { service, server, dataDir: resolved };
}

export interface RawResponse {
  status: number;
  headers: Headers;
  text: string;
}

export async function rawRequest(server: ReviewServer, method: string, pathname: string, init: RequestInit = {}): Promise<RawResponse> {
  const response = await fetch(`${server.url}${pathname}`, { ...init, method });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

export async function jsonRequest(server: ReviewServer, method: string, pathname: string, body?: unknown): Promise<RawResponse> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return rawRequest(server, method, pathname, init);
}

export async function snapshotBody(server: ReviewServer): Promise<WorkspaceSnapshot> {
  const response = await jsonRequest(server, 'GET', '/api/v1/workspace');
  if (response.status !== 200) throw new Error(`workspace snapshot failed with ${response.status}: ${response.text}`);
  return JSON.parse(response.text) as WorkspaceSnapshot;
}

export function viewOf(snapshot: WorkspaceSnapshot, id: string): WorkspaceSnapshot['workUnits'][number] {
  const view = snapshot.workUnits.find((candidate) => candidate.workUnit.id === id);
  if (!view) throw new Error(`work unit ${id} not in snapshot`);
  return view;
}

export async function registerUnit(server: ReviewServer, worktreePath: string, task = 'End-to-end work'): Promise<WorkUnit> {
  const response = await jsonRequest(server, 'POST', '/api/v1/work-units', { task, worktreePath, baseRef: 'main' });
  if (response.status !== 201) throw new Error(`register failed with ${response.status}: ${response.text}`);
  return JSON.parse(response.text) as WorkUnit;
}

export interface SseStream {
  /** The next `workspace.snapshot` event, or null at end of stream. */
  nextSnapshot(): Promise<{ type: string; seq: number; snapshot: WorkspaceSnapshot } | null>;
  close(): Promise<void>;
}

export async function openEvents(server: ReviewServer): Promise<SseStream> {
  const controller = new AbortController();
  const response = await fetch(`${server.url}/api/v1/events`, { signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const queue: { event: string; data: string }[] = [];
  const waiters: ((value: { event: string; data: string }) => void)[] = [];
  let buffer = '';
  let ended = false;

  const pump = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split: number;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          let event = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (!data) continue;
          const message = { event, data };
          const waiter = waiters.shift();
          if (waiter) waiter(message);
          else queue.push(message);
        }
      }
    } catch {
      // Aborted by close().
    }
    ended = true;
    for (const waiter of waiters.splice(0)) waiter({ event: 'eof', data: '' });
  })();

  return {
    nextSnapshot: async () => {
      const message = queue.length > 0
        ? queue.shift()!
        : ended
          ? { event: 'eof', data: '' }
          : await new Promise<{ event: string; data: string }>((resolve) => waiters.push(resolve));
      if (message.event === 'eof') return null;
      const parsed = JSON.parse(message.data) as { type: string; seq: number; snapshot: WorkspaceSnapshot };
      return parsed;
    },
    close: async () => {
      controller.abort();
      await pump;
    },
  };
}
