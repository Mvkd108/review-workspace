import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { GateDefinition, GateRun, TaskScope, WorkUnit } from '@review-workspace/schema';

type SqlValue = string | number | bigint | null;

export class WorkspaceStore {
  private readonly database: DatabaseSync;

  constructor(dataDirectory: string) {
    mkdirSync(dataDirectory, { recursive: true });
    this.database = new DatabaseSync(path.join(dataDirectory, 'review-workspace.db'));
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.database.exec(`
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
  }

  close(): void {
    this.database.close();
  }

  listWorkUnits(): WorkUnit[] {
    const rows = this.database.prepare('SELECT * FROM work_units ORDER BY created_at').all() as Record<string, SqlValue>[];
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
      scope: JSON.parse(String(row.scope_json)) as TaskScope,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  getWorkUnit(id: string): WorkUnit | undefined {
    return this.listWorkUnits().find((unit) => unit.id === id);
  }

  saveWorkUnit(workUnit: WorkUnit): void {
    this.database.prepare(`
      INSERT INTO work_units (
        id, kind, task, agent_label, agent_display_name, repository_id, repository_root,
        worktree_path, branch, base_ref, lifecycle, scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(workUnit.scope), workUnit.createdAt, workUnit.updatedAt,
    );
  }

  unregisterWorkUnit(id: string): boolean {
    return this.database.prepare('DELETE FROM work_units WHERE id = ?').run(id).changes > 0;
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

  setFilesReviewed(workUnitId: string, files: readonly string[], reviewed: boolean): void {
    const insert = this.database.prepare('INSERT OR REPLACE INTO reviewed_files (work_unit_id, file_path, reviewed_at) VALUES (?, ?, ?)');
    const remove = this.database.prepare('DELETE FROM reviewed_files WHERE work_unit_id = ? AND file_path = ?');
    const now = new Date().toISOString();
    for (const file of files) {
      if (reviewed) insert.run(workUnitId, file, now);
      else remove.run(workUnitId, file);
    }
  }
}
