import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkUnit } from '@review-workspace/schema';
import { DATABASE_SCHEMA_VERSION, WorkspaceStore, isWithinPath } from './store.js';

const temporary: string[] = [];
const now = new Date().toISOString();

function workUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  const id = overrides.id ?? 'unit-1';
  return {
    id,
    kind: 'unmanaged',
    task: 'Change value.txt',
    repositoryId: 'repo-1',
    repositoryRoot: '/repos/root',
    worktreePath: `/worktrees/${id}`,
    branch: 'feature',
    baseRef: 'main',
    lifecycle: 'observing',
    visibility: 'active',
    scope: { allowedGlobs: [], inferredPathTokens: [], confirmed: false },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('Workspace store schema versioning and migration', () => {
  it('creates a fresh database at the current schema version', async () => {
    const dataDir = await temporaryDirectory('review-workspace-fresh-');
    const store = new WorkspaceStore(dataDir);
    store.close();

    const db = new DatabaseSync(path.join(dataDir, 'review-workspace.db'));
    expect(Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)).toBe(DATABASE_SCHEMA_VERSION);
    db.close();
  });

  it('migrates a legacy 0.2.0 database without losing registrations, gates, runs, or reviewed state', async () => {
    const dataDir = await temporaryDirectory('review-workspace-legacy-');
    const db = new DatabaseSync(path.join(dataDir, 'review-workspace.db'));
    db.exec(`
      CREATE TABLE work_units (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        task TEXT NOT NULL,
        agent_label TEXT,
        agent_display_name TEXT,
        repository_id TEXT NOT NULL,
        repository_root TEXT NOT NULL,
        worktree_path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        scope_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE gate_definitions (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        name TEXT NOT NULL,
        program TEXT NOT NULL,
        args_json TEXT NOT NULL,
        cwd TEXT,
        env_allowlist_json TEXT NOT NULL,
        timeout_ms INTEGER NOT NULL,
        required INTEGER NOT NULL,
        definition_hash TEXT NOT NULL,
        approved_at TEXT NOT NULL
      );
      CREATE TABLE gate_runs (
        id TEXT PRIMARY KEY,
        gate_id TEXT NOT NULL REFERENCES gate_definitions(id) ON DELETE CASCADE,
        work_unit_id TEXT NOT NULL REFERENCES work_units(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        definition_hash TEXT NOT NULL,
        worktree_fingerprint TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        exit_code INTEGER,
        duration_ms INTEGER,
        output TEXT NOT NULL
      );
      CREATE TABLE reviewed_files (
        work_unit_id TEXT NOT NULL REFERENCES work_units(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        reviewed_at TEXT NOT NULL,
        PRIMARY KEY (work_unit_id, file_path)
      );
    `);
    db.prepare(`
      INSERT INTO work_units (
        id, kind, task, agent_label, repository_id, repository_root, worktree_path,
        branch, base_ref, lifecycle, scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('legacy-1', 'unmanaged', 'legacy task', 'codex', 'repo-1', '/repos/root', '/worktrees/legacy', 'feature', 'main', 'observing', '{"allowedGlobs":[],"inferredPathTokens":[],"confirmed":false}', now, now);
    db.prepare(`
      INSERT INTO gate_definitions (
        id, repository_id, name, program, args_json, env_allowlist_json,
        timeout_ms, required, definition_hash, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('gate-1', 'repo-1', 'Tests', 'pnpm.cmd', '["test"]', '[]', 600_000, 1, 'def-1', now);
    db.prepare(`
      INSERT INTO gate_runs (
        id, gate_id, work_unit_id, status, definition_hash, worktree_fingerprint,
        started_at, finished_at, exit_code, duration_ms, output
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('run-1', 'gate-1', 'legacy-1', 'passed', 'def-1', 'fp-1', now, now, 0, 1000, 'ok');
    db.prepare('INSERT INTO reviewed_files (work_unit_id, file_path, reviewed_at) VALUES (?, ?, ?)').run('legacy-1', 'src/legacy.ts', now);
    db.close();

    const store = new WorkspaceStore(dataDir);
    const units = store.listWorkUnits({ includeArchived: true });
    expect(units).toHaveLength(1);
    expect(units[0]?.id).toBe('legacy-1');
    expect(units[0]?.task).toBe('legacy task');
    expect(units[0]?.lifecycle).toBe('observing');
    expect(units[0]?.visibility).toBe('active');
    expect(store.listGateDefinitions('repo-1')).toHaveLength(1);
    expect(store.listGateRuns('legacy-1')).toHaveLength(1);
    expect(store.reviewedFiles('legacy-1')).toEqual(new Set(['src/legacy.ts']));
    store.close();

    const reopened = new DatabaseSync(path.join(dataDir, 'review-workspace.db'));
    expect(Number((reopened.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)).toBe(DATABASE_SCHEMA_VERSION);
    reopened.close();
  });

  it('refuses a database written by a newer host', async () => {
    const dataDir = await temporaryDirectory('review-workspace-newer-');
    const db = new DatabaseSync(path.join(dataDir, 'review-workspace.db'));
    db.exec('PRAGMA user_version = 99');
    db.close();
    expect(() => new WorkspaceStore(dataDir)).toThrow(/newer than this host supports/);
  });
});

describe('Workspace store visibility and archive', () => {
  it('hides archived work units by default and retains them with includeArchived', async () => {
    const dataDir = await temporaryDirectory('review-workspace-archive-');
    const store = new WorkspaceStore(dataDir);
    store.saveWorkUnit(workUnit({ id: 'active-1' }));
    store.saveWorkUnit(workUnit({ id: 'archive-1', task: 'retired' }));
    expect(store.setVisibility('archive-1', 'archived')).toBe(true);

    expect(store.listWorkUnits().map((unit) => unit.id)).toEqual(['active-1']);
    expect(store.getWorkUnit('archive-1')).toBeUndefined();
    expect(store.getWorkUnit('archive-1', { includeArchived: true })?.visibility).toBe('archived');
    expect(store.listWorkUnits({ includeArchived: true })).toHaveLength(2);
    store.close();
  });

  it('persists archived visibility across restart', async () => {
    const dataDir = await temporaryDirectory('review-workspace-reopen-');
    const store = new WorkspaceStore(dataDir);
    store.saveWorkUnit(workUnit({ id: 'archive-1' }));
    store.setVisibility('archive-1', 'archived');
    store.close();

    const reopened = new WorkspaceStore(dataDir);
    expect(reopened.listWorkUnits()).toHaveLength(0);
    expect(reopened.listWorkUnits({ includeArchived: true })[0]?.visibility).toBe('archived');
    reopened.close();
  });

  it('does not let a refresh-style save change the persisted visibility', async () => {
    const dataDir = await temporaryDirectory('review-workspace-refresh-');
    const store = new WorkspaceStore(dataDir);
    store.saveWorkUnit(workUnit({ id: 'archive-1' }));
    store.setVisibility('archive-1', 'archived');
    store.saveWorkUnit(workUnit({ id: 'archive-1', task: 'refreshed', lifecycle: 'observing', visibility: 'active' }));
    expect(store.getWorkUnit('archive-1', { includeArchived: true })?.visibility).toBe('archived');
    expect(store.getWorkUnit('archive-1', { includeArchived: true })?.task).toBe('refreshed');
    store.close();
  });

  it('bulk-archives only the ids that actually changed', async () => {
    const dataDir = await temporaryDirectory('review-workspace-bulk-');
    const store = new WorkspaceStore(dataDir);
    store.saveWorkUnit(workUnit({ id: 'a' }));
    store.saveWorkUnit(workUnit({ id: 'b' }));
    store.saveWorkUnit(workUnit({ id: 'c' }));
    const affected = store.setVisibilityMany(['a', 'b', 'missing'], 'archived');
    expect(affected).toEqual(['a', 'b']);
    expect(store.listWorkUnits().map((unit) => unit.id)).toEqual(['c']);
    store.close();
  });
});

describe('Workspace store data-directory safety', () => {
  it('classifies containment for the data-dir boundary', () => {
    const worktree = path.resolve('worktrees', 'feature');
    expect(isWithinPath(path.join(worktree, 'data'), worktree)).toBe(true);
    expect(isWithinPath(worktree, worktree)).toBe(true);
    expect(isWithinPath(path.dirname(worktree), worktree)).toBe(false);
    expect(isWithinPath(path.join(path.dirname(worktree), 'sibling'), worktree)).toBe(false);
  });

  it('refuses to save a work unit whose worktree contains the host data directory', async () => {
    const worktree = await temporaryDirectory('review-workspace-worktree-');
    const store = new WorkspaceStore(path.join(worktree, 'host-data'));
    expect(() => store.saveWorkUnit(workUnit({ worktreePath: path.join(worktree, 'host-data') }))).toThrow(/contains the host-owned data directory/);
    expect(() => store.saveWorkUnit(workUnit({ worktreePath: worktree }))).toThrow(/contains the host-owned data directory/);
    store.close();
  });

  it('refuses to open when the data directory already lives inside an observed worktree', async () => {
    const worktree = await temporaryDirectory('review-workspace-worktree-');
    const elsewhere = await temporaryDirectory('review-workspace-data-');
    const store = new WorkspaceStore(elsewhere);
    store.saveWorkUnit(workUnit({ worktreePath: worktree }));
    store.close();

    const moved = path.join(worktree, 'host-data');
    await mkdir(moved, { recursive: true });
    // After a clean close the main database file is self-contained; copying the
    // WAL/SHM sidecars would replay frames against the wrong location.
    await copyFile(path.join(elsewhere, 'review-workspace.db'), path.join(moved, 'review-workspace.db'));

    expect(() => new WorkspaceStore(moved)).toThrow(/inside observed worktree/);
  });
});
