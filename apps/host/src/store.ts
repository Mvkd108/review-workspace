import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { GateDefinition, GateRun, TaskScope, WorkUnit, WorkUnitVisibility } from '@review-workspace/schema';
import { isWithinPath } from './paths.js';

export { isWithinPath };

type SqlValue = string | number | bigint | null;

/** The storage schema version, tracked with SQLite's PRAGMA user_version. */
export const DATABASE_SCHEMA_VERSION = 2;

interface Migration {
  version: number;
  up(database: DatabaseSync): void;
}

function tableHasColumn(database: DatabaseSync, table: string, column: string): boolean {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((item) => item.name === column);
}

const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    // Version 1: the 0.3.0-beta.1 storage shape. A legacy 0.2.0 database is
    // recognised by the absence of the visibility column and upgraded in place,
    // so registrations, gates, runs, and reviewed state survive the move.
    version: 1,
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS work_units (
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
          visibility TEXT NOT NULL DEFAULT 'active',
          scope_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS gate_definitions (
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
        CREATE TABLE IF NOT EXISTS gate_runs (
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
        CREATE INDEX IF NOT EXISTS gate_runs_lookup ON gate_runs(work_unit_id, gate_id, started_at DESC);
        CREATE TABLE IF NOT EXISTS reviewed_files (
          work_unit_id TEXT NOT NULL REFERENCES work_units(id) ON DELETE CASCADE,
          file_path TEXT NOT NULL,
          reviewed_at TEXT NOT NULL,
          PRIMARY KEY (work_unit_id, file_path)
        );
      `);
      if (!tableHasColumn(database, 'work_units', 'visibility')) {
        database.exec(`ALTER TABLE work_units ADD COLUMN visibility TEXT NOT NULL DEFAULT 'active'`);
      }
    },
  },
  {
    // Version 2: reviewed markers record the content hash of the patch they
    // reviewed, so a later content change can reset the marker.
    version: 2,
    up(database) {
      if (!tableHasColumn(database, 'reviewed_files', 'content_hash')) {
        database.exec(`ALTER TABLE reviewed_files ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''`);
      }
    },
  },
];

export class WorkspaceStore {
  private readonly database: DatabaseSync;

  constructor(readonly dataDirectory: string) {
    mkdirSync(dataDirectory, { recursive: true });
    this.database = new DatabaseSync(path.join(dataDirectory, 'review-workspace.db'));
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.applyMigrations();
    for (const unit of this.listWorkUnits({ includeArchived: true })) {
      if (isWithinPath(this.dataDirectory, unit.worktreePath)) {
        // A failed construction must not leak an open database handle.
        this.database.close();
        throw new Error(
          `Host-owned data directory ${this.dataDirectory} is inside observed worktree ${unit.worktreePath}. ` +
            `Move --data-dir outside any observed repository so a branch cannot alter the checks that judge it.`,
        );
      }
    }
  }

  private applyMigrations(): void {
    const row = this.database.prepare('PRAGMA user_version').get() as { user_version: number };
    const current = Number(row.user_version);
    if (current > DATABASE_SCHEMA_VERSION) {
      throw new Error(`Database schema version ${current} is newer than this host supports (${DATABASE_SCHEMA_VERSION}).`);
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      this.database.exec('BEGIN');
      try {
        migration.up(this.database);
        this.database.exec(`PRAGMA user_version = ${migration.version}`);
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    }
  }

  close(): void {
    this.database.close();
  }

  listWorkUnits(options?: { includeArchived?: boolean }): WorkUnit[] {
    const includeArchived = options?.includeArchived ?? false;
    const rows = this.database
      .prepare(includeArchived ? 'SELECT * FROM work_units ORDER BY created_at' : "SELECT * FROM work_units WHERE visibility != 'archived' ORDER BY created_at")
      .all() as Record<string, SqlValue>[];
    return rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind) as WorkUnit['kind'],
      task: String(row.task),
      ...(row.agent_label ? { agentLabel: String(row.agent_label) as NonNullable<WorkUnit['agentLabel']> } : {}),
      ...(row.agent_display_name ? { agentDisplayName: String(row.agent_display_name) } : {}),
      repositoryId: String(row.repository_id),
      repositoryRoot: String(row.repository_root),
      worktreePath: String(row.worktree_path),
      branch: String(row.branch),
      baseRef: String(row.base_ref),
      lifecycle: String(row.lifecycle) as WorkUnit['lifecycle'],
      visibility: String(row.visibility) as WorkUnit['visibility'],
      scope: JSON.parse(String(row.scope_json)) as TaskScope,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  getWorkUnit(id: string, options?: { includeArchived?: boolean }): WorkUnit | undefined {
    return this.listWorkUnits(options).find((unit) => unit.id === id);
  }

  saveWorkUnit(workUnit: WorkUnit): void {
    if (isWithinPath(this.dataDirectory, workUnit.worktreePath)) {
      throw new Error(
        `Worktree ${workUnit.worktreePath} contains the host-owned data directory ${this.dataDirectory}. ` +
          `Refusing to register it so a branch cannot alter the checks that judge it.`,
      );
    }
    this.database.prepare(`
      INSERT INTO work_units (
        id, kind, task, agent_label, agent_display_name, repository_id, repository_root,
        worktree_path, branch, base_ref, lifecycle, visibility, scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind=excluded.kind, task=excluded.task, agent_label=excluded.agent_label,
        agent_display_name=excluded.agent_display_name, repository_id=excluded.repository_id,
        repository_root=excluded.repository_root, worktree_path=excluded.worktree_path,
        branch=excluded.branch, base_ref=excluded.base_ref, lifecycle=excluded.lifecycle,
        scope_json=excluded.scope_json, updated_at=excluded.updated_at
    `).run(
      workUnit.id, workUnit.kind, workUnit.task, workUnit.agentLabel ?? null,
      workUnit.agentDisplayName ?? null, workUnit.repositoryId, workUnit.repositoryRoot,
      workUnit.worktreePath, workUnit.branch, workUnit.baseRef, workUnit.lifecycle,
      workUnit.visibility, JSON.stringify(workUnit.scope), workUnit.createdAt, workUnit.updatedAt,
    );
  }

  unregisterWorkUnit(id: string): boolean {
    return this.database.prepare('DELETE FROM work_units WHERE id = ?').run(id).changes > 0;
  }

  /** Archive or unarchive a single work unit. Returns whether a row changed. */
  setVisibility(id: string, visibility: WorkUnitVisibility): boolean {
    return this.database.prepare('UPDATE work_units SET visibility = ? WHERE id = ?').run(visibility, id).changes > 0;
  }

  /** Bulk archive or unarchive. Returns the ids whose visibility actually changed. */
  setVisibilityMany(ids: readonly string[], visibility: WorkUnitVisibility): string[] {
    const affected: string[] = [];
    const statement = this.database.prepare('UPDATE work_units SET visibility = ? WHERE id = ?');
    for (const id of ids) if (statement.run(visibility, id).changes > 0) affected.push(id);
    return affected;
  }

  listGateDefinitions(repositoryId: string): GateDefinition[] {
    const rows = this.database.prepare('SELECT * FROM gate_definitions WHERE repository_id = ? ORDER BY name').all(repositoryId) as Record<string, SqlValue>[];
    return rows.map((row) => ({
      id: String(row.id),
      repositoryId: String(row.repository_id),
      name: String(row.name),
      program: String(row.program),
      args: JSON.parse(String(row.args_json)) as string[],
      ...(row.cwd ? { cwd: String(row.cwd) } : {}),
      envAllowlist: JSON.parse(String(row.env_allowlist_json)) as string[],
      timeoutMs: Number(row.timeout_ms),
      required: Number(row.required) === 1,
      definitionHash: String(row.definition_hash),
      approvedAt: String(row.approved_at),
    }));
  }

  getGateDefinition(id: string): GateDefinition | undefined {
    const row = this.database.prepare('SELECT repository_id FROM gate_definitions WHERE id = ?').get(id) as { repository_id?: string } | undefined;
    return row?.repository_id ? this.listGateDefinitions(row.repository_id).find((gate) => gate.id === id) : undefined;
  }

  saveGateDefinition(gate: GateDefinition): void {
    this.database.prepare(`
      INSERT INTO gate_definitions (
        id, repository_id, name, program, args_json, cwd, env_allowlist_json,
        timeout_ms, required, definition_hash, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, program=excluded.program,
        args_json=excluded.args_json, cwd=excluded.cwd, env_allowlist_json=excluded.env_allowlist_json,
        timeout_ms=excluded.timeout_ms, required=excluded.required,
        definition_hash=excluded.definition_hash, approved_at=excluded.approved_at
    `).run(
      gate.id, gate.repositoryId, gate.name, gate.program, JSON.stringify(gate.args), gate.cwd ?? null,
      JSON.stringify(gate.envAllowlist), gate.timeoutMs, gate.required ? 1 : 0,
      gate.definitionHash, gate.approvedAt,
    );
  }

  removeGateDefinition(id: string): boolean {
    return this.database.prepare('DELETE FROM gate_definitions WHERE id = ?').run(id).changes > 0;
  }

  saveGateRun(run: GateRun): void {
    this.database.prepare(`
      INSERT INTO gate_runs (
        id, gate_id, work_unit_id, status, definition_hash, worktree_fingerprint,
        started_at, finished_at, exit_code, duration_ms, output
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id, run.gateId, run.workUnitId, run.status, run.definitionHash,
      run.worktreeFingerprint, run.startedAt, run.finishedAt ?? null, run.exitCode ?? null,
      run.durationMs ?? null, run.output,
    );
  }

  listGateRuns(workUnitId: string): GateRun[] {
    const rows = this.database.prepare('SELECT * FROM gate_runs WHERE work_unit_id = ? ORDER BY started_at DESC').all(workUnitId) as Record<string, SqlValue>[];
    return rows.map((row) => ({
      id: String(row.id),
      gateId: String(row.gate_id),
      workUnitId: String(row.work_unit_id),
      status: String(row.status) as GateRun['status'],
      definitionHash: String(row.definition_hash),
      worktreeFingerprint: String(row.worktree_fingerprint),
      startedAt: String(row.started_at),
      ...(row.finished_at ? { finishedAt: String(row.finished_at) } : {}),
      ...(row.exit_code !== null ? { exitCode: Number(row.exit_code) } : {}),
      ...(row.duration_ms !== null ? { durationMs: Number(row.duration_ms) } : {}),
      output: String(row.output),
    }));
  }

  reviewedFiles(workUnitId: string): Set<string> {
    const rows = this.database.prepare('SELECT file_path FROM reviewed_files WHERE work_unit_id = ?').all(workUnitId) as { file_path: string }[];
    return new Set(rows.map((row) => row.file_path));
  }

  reviewedFileHashes(workUnitId: string): Map<string, string> {
    const rows = this.database.prepare('SELECT file_path, content_hash FROM reviewed_files WHERE work_unit_id = ?').all(workUnitId) as { file_path: string; content_hash: string }[];
    return new Map(rows.map((row) => [row.file_path, row.content_hash]));
  }

  setFilesReviewed(workUnitId: string, files: readonly { path: string; contentHash: string }[], reviewed: boolean): void {
    const insert = this.database.prepare('INSERT OR REPLACE INTO reviewed_files (work_unit_id, file_path, reviewed_at, content_hash) VALUES (?, ?, ?, ?)');
    const remove = this.database.prepare('DELETE FROM reviewed_files WHERE work_unit_id = ? AND file_path = ?');
    const now = new Date().toISOString();
    for (const file of files) {
      if (reviewed) insert.run(workUnitId, file.path, now, file.contentHash);
      else remove.run(workUnitId, file.path);
    }
  }

  /**
   * Reset reviewed markers whose patch changed and drop markers for files no
   * longer in the change set. Legacy markers without a stored hash are upgraded
   * to the current hash so they stay valid until the patch actually changes.
   * Returns the paths whose review was cleared.
   */
  reconcileReviewedHashes(workUnitId: string, fileHashes: ReadonlyMap<string, string>, currentPaths: readonly string[]): string[] {
    const cleared: string[] = [];
    const current = new Set(currentPaths);
    const setHash = this.database.prepare('UPDATE reviewed_files SET content_hash = ? WHERE work_unit_id = ? AND file_path = ?');
    const remove = this.database.prepare('DELETE FROM reviewed_files WHERE work_unit_id = ? AND file_path = ?');
    for (const [filePath, storedHash] of this.reviewedFileHashes(workUnitId)) {
      if (!current.has(filePath)) {
        remove.run(workUnitId, filePath);
        cleared.push(filePath);
        continue;
      }
      const currentHash = fileHashes.get(filePath) ?? '';
      if (storedHash === '') {
        setHash.run(currentHash, workUnitId, filePath);
      } else if (storedHash !== currentHash) {
        remove.run(workUnitId, filePath);
        cleared.push(filePath);
      }
    }
    return cleared;
  }
}
