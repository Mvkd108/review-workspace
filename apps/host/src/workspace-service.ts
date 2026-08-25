import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type {
  AgentActivity,
  AgentSession,
  AttentionItem,
  GateDefinition,
  GateDefinitionInput,
  GateProposal,
  GateRun,
  MergeReadiness,
  ReviewedFilesInput,
  WorkUnit,
  WorkUnitRegistration,
  WorkUnitView,
  WorkspaceEvent,
  WorkspaceSnapshot,
  WorkspaceSnapshotStatus,
} from '@review-workspace/schema';
import { WORKSPACE_SCHEMA_VERSION } from '@review-workspace/schema';
import type { RepositoryInspection } from '@review-workspace/adapter-api';
import { AgentActivityObserver, summarize } from './agent-activity.js';
import { sha256, stableJson } from './hash.js';
import { GitCliRepositoryAdapter } from './git-adapter.js';
import { LocalProcessGateProvider } from './gate-provider.js';
import { assessRisk } from './risk.js';
import { WorkspaceStore, isWithinPath } from './store.js';
import { inferPathTokens } from './task-scope.js';

type Subscriber = (event: WorkspaceEvent) => void;

/** Bounded parallel map so a large workspace never spawns unbounded Git processes. */
const INSPECTION_CONCURRENCY = 4;

async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function latestRunsByGate(runs: readonly GateRun[]): Map<string, GateRun> {
  const latest = new Map<string, GateRun>();
  for (const run of runs) if (!latest.has(run.gateId)) latest.set(run.gateId, run);
  return latest;
}

function mergeReadiness(
  change: NonNullable<WorkUnitView['change']>,
  mergeConflict: boolean | null,
  gates: readonly GateDefinition[],
  latestRuns: ReadonlyMap<string, GateRun>,
): MergeReadiness {
  if (!change.baseCommit) return { status: 'unknown', reasons: ['The configured base reference does not resolve.'] };
  const reasons: string[] = [];
  if (change.dirty) reasons.push('The worktree contains uncommitted changes.');
  if (mergeConflict === true) reasons.push('The branch conflicts with the configured base reference.');
  if (mergeConflict === null && !change.dirty && change.ahead > 0) reasons.push('Git could not determine conflict status.');

  const required = gates.filter((gate) => gate.required);
  for (const gate of required) {
    const run = latestRuns.get(gate.id);
    if (!run || run.definitionHash !== gate.definitionHash || run.worktreeFingerprint !== change.fingerprint) {
      reasons.push(`${gate.name} has no current result for this diff.`);
    } else if (run.status !== 'passed') {
      reasons.push(`${gate.name} did not pass.`);
    }
  }

  if (reasons.length > 0) return { status: 'blocked', reasons };
  if (change.ahead === 0) return { status: 'unknown', reasons: ['The branch has no commits ahead of the base reference.'] };
  if (required.length === 0) return { status: 'unknown', reasons: ['No required trusted gates are configured.'] };
  return { status: 'ready', reasons: ['The branch is clean, conflict-free, ahead of base, and all required trusted gates passed.'] };
}

function describeAgents(sessions: readonly AgentSession[]): string {
  const labels = [...new Set(sessions.map((session) => session.agentLabel))];
  return labels.length > 0 ? labels.join(' and ') : 'An agent';
}

function attentionFor(view: Omit<WorkUnitView, 'attention' | 'queueTier'>, mergeConflict: boolean | null): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (kind: AttentionItem['kind'], severity: AttentionItem['severity'], title: string, detail: string) => {
    items.push({ id: `${view.workUnit.id}:${kind}:${items.length}`, workUnitId: view.workUnit.id, kind, severity, title, detail });
  };
  if (!view.change) add('unavailable', 'high', 'Worktree unavailable', 'Git inspection failed for this registered path.');
  const activity = view.agentActivity;
  if (activity.state === 'working') {
    const open = activity.sessions.filter((session) => !session.lastTurnComplete);
    add('agent-working', 'low', 'Agent still working', `${describeAgents(open)} has an open turn here. Review may be premature.`);
  } else if (activity.state === 'stalled') {
    const open = activity.sessions.filter((session) => !session.lastTurnComplete);
    add('agent-stalled', 'medium', 'Agent stopped mid-turn', `${describeAgents(open)} started a turn and stopped writing. It may have been interrupted, or be inside a long tool call.`);
  }
  if (mergeConflict === true) add('merge-conflict', 'high', 'Resolve merge conflict', 'The clean branch does not merge into the configured base ref.');
  for (const reason of view.risk.reasons) {
    if (reason.code.startsWith('gate.failed')) add('gate-failed', 'high', reason.label, reason.detail);
    else if (reason.code.startsWith('gate.stale')) add('gate-stale', 'medium', reason.label, reason.detail);
    else if (reason.code.startsWith('scope.')) add('scope', 'medium', reason.label, reason.detail);
  }
  if (view.change && view.change.files.length > 0) add('ready-for-review', view.risk.level, 'Changes ready for review', `${view.change.files.length} changed file${view.change.files.length === 1 ? '' : 's'}.`);
  return items;
}

/** Normalize a client-supplied file path for the per-file diff endpoint, or null when unsafe. */
function normalizeReviewPath(filePath: string): string | null {
  if (path.isAbsolute(filePath)) return null;
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.split('/').includes('..')) return null;
  return normalized;
}

function queueTier(view: Omit<WorkUnitView, 'attention' | 'queueTier'>, mergeConflict: boolean | null): number {
  if (!view.change || mergeConflict === true || view.risk.reasons.some((item) => item.code.startsWith('gate.failed'))) return 0;
  // An agent that stopped mid-turn needs a look; one still writing does not yet.
  if (view.agentActivity.state === 'stalled') return 1;
  if (view.agentActivity.state === 'working') return 4;
  if (view.risk.level === 'high') return 1;
  if (view.change.files.length > 0) return 2;
  return 3;
}

export class WorkspaceService {
  private readonly git: GitCliRepositoryAdapter;
  private readonly gates = new LocalProcessGateProvider();
  private readonly agents = new AgentActivityObserver();
  private readonly subscribers = new Set<Subscriber>();
  /** Last published view per active work unit, so partial snapshots keep prior evidence. */
  private readonly views = new Map<string, WorkUnitView>();
  /** Cached Git inspection per work unit, reused by cheap agent-only refreshes. */
  private readonly inspections = new Map<string, RepositoryInspection>();
  private snapshot: WorkspaceSnapshot = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    seq: 0,
    generatedAt: new Date().toISOString(),
    workUnits: [],
    status: 'stale',
    inspectedAt: new Date().toISOString(),
    staleReason: 'Waiting for the first reconciliation.',
  };
  private watcher: FSWatcher | undefined;
  private interval: NodeJS.Timeout | undefined;
  private refreshDebounce: NodeJS.Timeout | undefined;
  private refreshing: Promise<void> | undefined;
  /** Worktree paths with known changes not yet reinspected (coalesced watcher input). */
  private readonly pendingPaths = new Set<string>();
  private fullRefreshRequested = false;
  private agentOnlyRequested = false;
  /** Paths the watcher refused; the periodic tick covers them by Git polling. */
  private readonly watchFailures = new Set<string>();
  /** Watcher errors that could not be mapped to a registered path, reported once. */
  private readonly degradedUnknownMessages = new Set<string>();
  private degradedUnknown = false;
  /** Paths whose last Git inspection failed. */
  private readonly inspectionFailures = new Set<string>();

  constructor(readonly store: WorkspaceStore, deps: { git?: GitCliRepositoryAdapter } = {}) {
    this.git = deps.git ?? new GitCliRepositoryAdapter();
  }

  current(): WorkspaceSnapshot {
    return this.snapshot;
  }

  /**
   * Archived work units, as lightweight views. They are no longer observed, so
   * no Git inspection runs here; the rows carry only registration identity and
   * the stored gate state. This is a read surface, never a deletion path.
   */
  async archived(): Promise<WorkspaceSnapshot> {
    const units = this.store.listWorkUnits({ includeArchived: true }).filter((unit) => unit.visibility === 'archived');
    const workUnits: WorkUnitView[] = units.map((unit) => ({
      workUnit: unit,
      change: null,
      agentActivity: { state: 'unknown', sessions: [] },
      risk: { level: 'low', sortScore: 0, reasons: [] },
      mergeReadiness: { status: 'unknown', reasons: ['Archived work unit.'] },
      gateDefinitions: this.store.listGateDefinitions(unit.repositoryId),
      gateProposals: [],
      gateRuns: this.store.listGateRuns(unit.id),
      attention: [],
      queueTier: 3,
    }));
    return { schemaVersion: WORKSPACE_SCHEMA_VERSION, seq: this.snapshot.seq, generatedAt: new Date().toISOString(), workUnits };
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  async start(): Promise<void> {
    const paths = this.store.listWorkUnits().map((unit) => unit.worktreePath);
    this.watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      ignored: [/(^|[\\/])\.git([\\/]|$)/, /(^|[\\/])node_modules([\\/]|$)/, /(^|[\\/])dist([\\/]|$)/],
      awaitWriteFinish: { stabilityThreshold: 350, pollInterval: 100 },
    });
    this.watcher.on('all', (_event, changedPath) => {
      if (typeof changedPath === 'string') this.handleWorktreeChange(changedPath);
    });
    // One unreadable path must not take the host down with it. Windows raises EPERM
    // on realpath for locked directories, and chokidar surfaces that as an error
    // event that would otherwise go unhandled and kill the process. The periodic
    // tick re-inspects the affected path directly, so it degrades to polling
    // rather than losing the work unit.
    this.watcher.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      const affectedPath = this.matchWatchPath(message);
      if (affectedPath) {
        if (this.watchFailures.has(affectedPath)) return;
        this.watchFailures.add(affectedPath);
      } else {
        if (this.degradedUnknownMessages.has(message)) return;
        this.degradedUnknownMessages.add(message);
        this.degradedUnknown = true;
      }
      process.stderr.write(`Watch degraded to polling for one path: ${message}\n`);
      this.publishSnapshot('stale');
    });
    this.interval = setInterval(() => void this.tick(), 15_000);
    this.interval.unref();
    // First reconciliation runs in the background and publishes partial
    // snapshots as each work unit completes; the shell was already available.
    void this.refresh();
  }

  private async tick(): Promise<void> {
    await this.drainRefresh();
    if (this.watchFailures.size > 0) await this.refresh({ worktreePaths: [...this.watchFailures] });
    if (this.degradedUnknown) {
      this.degradedUnknown = false;
      await this.refresh();
    }
    await this.refresh({ agentOnly: true });
  }

  /** Recover the degraded worktree path from a watcher error message, if any. */
  private matchWatchPath(message: string): string | undefined {
    for (const unit of this.store.listWorkUnits()) {
      if (message.includes(unit.worktreePath) || message.includes(unit.worktreePath.replaceAll('\\', '/'))) return unit.worktreePath;
    }
    return undefined;
  }

  async stop(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    if (this.refreshDebounce) clearTimeout(this.refreshDebounce);
    // A reconciliation may be in flight (start kicks one off immediately). Close
    // the store only after it settles, or publishSnapshot would touch a closed
    // database and take the daemon down during shutdown.
    while (this.refreshing) await this.refreshing;
    await this.watcher?.close();
    this.store.close();
  }

  /** Public for tests and watcher wiring: a file changed and must be reinspected. */
  handleWorktreeChange(changedPath: string): void {
    if (!changedPath) return;
    const worktreePath = this.matchWorktreePath(changedPath);
    if (!worktreePath) return;
    this.pendingPaths.add(worktreePath);
    if (this.refreshDebounce) return;
    this.refreshDebounce = setTimeout(() => {
      this.refreshDebounce = undefined;
      this.publishSnapshot('stale');
      // Drain the coalesced pending paths; do not escalate to a full refresh.
      void this.drainRefresh();
    }, 300);
    this.refreshDebounce.unref();
  }

  /** Map a changed file path back to the registered worktree that contains it. */
  private matchWorktreePath(changedPath: string): string | undefined {
    const normalized = path.resolve(changedPath);
    for (const unit of this.store.listWorkUnits()) {
      if (isWithinPath(normalized, unit.worktreePath)) return unit.worktreePath;
    }
    return undefined;
  }

  async register(input: WorkUnitRegistration): Promise<WorkUnit> {
    if (!input.task?.trim()) throw new Error('Task is required.');
    if (!input.worktreePath?.trim()) throw new Error('Worktree path is required.');
    if (input.kind === 'managed') throw new Error('Managed work units remain gated on Phase 0b. Register this worktree as unmanaged for now.');
    const identity = await this.git.resolveIdentity(input.worktreePath, input.baseRef);
    const now = new Date().toISOString();
    const workUnit: WorkUnit = {
      id: randomUUID(),
      kind: 'unmanaged',
      task: input.task.trim(),
      ...(input.agentLabel ? { agentLabel: input.agentLabel } : {}),
      ...(input.agentDisplayName?.trim() ? { agentDisplayName: input.agentDisplayName.trim() } : {}),
      repositoryId: identity.repositoryId,
      repositoryRoot: identity.repositoryRoot,
      worktreePath: identity.worktreePath,
      branch: identity.branch,
      baseRef: identity.baseRef,
      lifecycle: 'observing',
      visibility: 'active',
      scope: {
        allowedGlobs: (input.allowedGlobs ?? []).filter(Boolean),
        inferredPathTokens: inferPathTokens(input.task),
        confirmed: Boolean(input.allowedGlobs?.length),
      },
      createdAt: now,
      updatedAt: now,
    };
    this.store.saveWorkUnit(workUnit);
    this.watcher?.add(workUnit.worktreePath);
    await this.refresh({ worktreePaths: [workUnit.worktreePath] });
    return workUnit;
  }

  async unregister(id: string): Promise<boolean> {
    const unit = this.store.getWorkUnit(id);
    const removed = this.store.unregisterWorkUnit(id);
    if (removed && unit) {
      await this.watcher?.unwatch(unit.worktreePath);
      this.views.delete(id);
      this.inspections.delete(id);
      this.watchFailures.delete(unit.worktreePath);
      this.git.forgetCachedDiff(id);
      this.publishSnapshot(this.currentStaleness());
    }
    return removed;
  }

  async archive(id: string): Promise<WorkUnit | undefined> {
    const unit = this.store.getWorkUnit(id);
    if (!unit) return undefined;
    this.store.setVisibility(id, 'archived');
    await this.watcher?.unwatch(unit.worktreePath);
    this.views.delete(id);
    this.inspections.delete(id);
    this.publishSnapshot(this.currentStaleness());
    return this.store.getWorkUnit(id, { includeArchived: true });
  }

  async unarchive(id: string): Promise<WorkUnit | undefined> {
    const unit = this.store.getWorkUnit(id, { includeArchived: true });
    if (!unit) return undefined;
    this.store.setVisibility(id, 'active');
    this.watcher?.add(unit.worktreePath);
    await this.refresh({ worktreePaths: [unit.worktreePath] });
    return this.store.getWorkUnit(id);
  }

  async archiveMany(ids: readonly string[]): Promise<string[]> {
    const affected = this.store.setVisibilityMany(ids, 'archived');
    for (const id of affected) {
      const unit = this.store.getWorkUnit(id, { includeArchived: true });
      if (unit) await this.watcher?.unwatch(unit.worktreePath);
      this.views.delete(id);
      this.inspections.delete(id);
    }
    this.publishSnapshot(this.currentStaleness());
    return affected;
  }

  async addGate(workUnitId: string, input: GateDefinitionInput): Promise<GateDefinition> {
    const unit = this.requireUnit(workUnitId);
    if (!input.name?.trim() || !input.program?.trim()) throw new Error('Gate name and executable are required.');
    const normalized = {
      name: input.name.trim(),
      program: input.program.trim(),
      args: input.args ?? [],
      ...(input.cwd?.trim() ? { cwd: input.cwd.trim() } : {}),
      envAllowlist: input.envAllowlist ?? [],
      timeoutMs: Math.min(Math.max(input.timeoutMs ?? 600_000, 1_000), 3_600_000),
      required: input.required ?? true,
    };
    const gate: GateDefinition = {
      id: randomUUID(),
      repositoryId: unit.repositoryId,
      ...normalized,
      definitionHash: sha256(stableJson(normalized)),
      approvedAt: new Date().toISOString(),
    };
    this.store.saveGateDefinition(gate);
    await this.refresh({ worktreePaths: [unit.worktreePath] });
    return gate;
  }

  async runGate(workUnitId: string, gateId: string, force = true): Promise<GateRun> {
    const unit = this.requireUnit(workUnitId);
    const gate = this.store.getGateDefinition(gateId);
    if (!gate || gate.repositoryId !== unit.repositoryId) throw new Error('Trusted gate not found for this repository.');
    const inspected = await this.git.inspect(unit, this.store.reviewedFiles(unit.id));
    const existing = latestRunsByGate(this.store.listGateRuns(unit.id)).get(gate.id);
    if (!force && existing && existing.definitionHash === gate.definitionHash && existing.worktreeFingerprint === inspected.change.fingerprint) return existing;
    const run = await this.gates.run(unit, gate, inspected.change.fingerprint);
    this.store.saveGateRun(run);
    await this.refresh({ worktreePaths: [unit.worktreePath] });
    return run;
  }

  async removeGate(workUnitId: string, gateId: string): Promise<boolean> {
    const unit = this.requireUnit(workUnitId);
    const gate = this.store.getGateDefinition(gateId);
    if (!gate || gate.repositoryId !== unit.repositoryId) return false;
    const removed = this.store.removeGateDefinition(gateId);
    if (removed) await this.refresh({ worktreePaths: [unit.worktreePath] });
    return removed;
  }

  async setReviewed(workUnitId: string, input: ReviewedFilesInput): Promise<void> {
    const unit = this.requireUnit(workUnitId);
    const hashes = this.inspections.get(unit.id)?.fileHashes;
    const files = input.files.map((filePath) => ({ path: filePath, contentHash: hashes?.get(filePath) ?? '' }));
    this.store.setFilesReviewed(workUnitId, files, input.reviewed);
    await this.refresh({ worktreePaths: [unit.worktreePath] });
  }

  async diff(workUnitId: string): Promise<string> {
    const unit = this.requireUnit(workUnitId);
    if (!this.views.has(unit.id)) await this.git.inspect(unit, this.store.reviewedFiles(unit.id));
    return this.git.getCachedDiff(workUnitId) ?? '';
  }

  /**
   * Per-file diff for a single changed file. The requested path must be a
   * member of the work unit's change set; it is never used to touch the
   * filesystem, so traversal is impossible even for malformed input.
   */
  async fileDiff(workUnitId: string, filePath: string): Promise<string | null> {
    const unit = this.requireUnit(workUnitId);
    const normalized = normalizeReviewPath(filePath);
    if (normalized === null) return null;
    const files = this.views.get(unit.id)?.change?.files;
    if (files) {
      if (!files.some((file) => file.path === normalized)) return null;
    } else {
      const inspected = await this.git.inspect(unit, this.store.reviewedFiles(unit.id));
      if (!inspected.change.files.some((file) => file.path === normalized)) return null;
    }
    return this.git.diffForFile(workUnitId, normalized) ?? null;
  }

  /**
   * Reconcile the workspace. With `worktreePaths` only those worktrees are
   * reinspected; without them every active work unit is inspected. `agentOnly`
   * re-derives agent activity from cached Git evidence without running Git.
   * No-op reconciliations never advance the snapshot sequence.
   */
  async refresh(options?: { worktreePaths?: readonly string[]; agentOnly?: boolean }): Promise<void> {
    if (options?.worktreePaths?.length) {
      for (const changedPath of options.worktreePaths) this.pendingPaths.add(changedPath);
    } else if (options?.agentOnly) {
      this.agentOnlyRequested = true;
    } else {
      this.fullRefreshRequested = true;
    }
    return this.drainRefresh();
  }

  /** Agent observation is advisory; a failure here must not break the repo channel. */
  private async collectAgentSessions(): Promise<AgentSession[]> {
    try {
      return await this.agents.collect();
    } catch {
      return [];
    }
  }

  private async drainRefresh(): Promise<void> {
    // Wait for any in-flight loop rather than dropping the request; the loop
    // re-checks the queues each iteration, so work enqueued while it runs is
    // still picked up.
    while (this.refreshing) await this.refreshing;
    if (this.pendingPaths.size === 0 && !this.fullRefreshRequested && !this.agentOnlyRequested) return;
    this.refreshing = (async () => {
      while (this.pendingPaths.size > 0 || this.fullRefreshRequested || this.agentOnlyRequested) {
        if (this.fullRefreshRequested) {
          this.fullRefreshRequested = false;
          await this.performRefresh();
        } else if (this.agentOnlyRequested) {
          this.agentOnlyRequested = false;
          await this.refreshAgentActivity();
        } else {
          const changedPaths = [...this.pendingPaths];
          this.pendingPaths.clear();
          await this.performRefresh(changedPaths);
        }
      }
    })().finally(() => {
      this.refreshing = undefined;
    });
    await this.refreshing;
  }

  private currentStaleness(): WorkspaceSnapshotStatus {
    return this.pendingPaths.size > 0 || this.watchFailures.size > 0 || this.degradedUnknown || this.inspectionFailures.size > 0 ? 'stale' : 'fresh';
  }

  private staleReasonText(): string {
    if (this.pendingPaths.size > 0) return 'Changes are awaiting reinspection.';
    if (this.watchFailures.size > 0) return `Watch degraded for ${this.watchFailures.size} path${this.watchFailures.size === 1 ? '' : 's'}; Git polling covers them.`;
    if (this.inspectionFailures.size > 0) return `Inspection failed for ${this.inspectionFailures.size} path${this.inspectionFailures.size === 1 ? '' : 's'}.`;
    if (this.degradedUnknown) return 'Watch degraded for an unidentified path; Git polling covers it.';
    return 'Evidence currency cannot be confirmed.';
  }

  /**
   * Build and publish a full snapshot from the cached views. Unchanged evidence
   * with an unchanged status does not advance the sequence. Views for units that
   * are no longer active are pruned so the map cannot grow without bound.
   */
  private publishSnapshot(status: WorkspaceSnapshotStatus, staleReason?: string): void {
    const activeUnits = this.store.listWorkUnits();
    const activeIds = new Set(activeUnits.map((unit) => unit.id));
    for (const id of [...this.views.keys()]) if (!activeIds.has(id)) this.views.delete(id);
    const workUnits = activeUnits
      .map((unit) => this.views.get(unit.id))
      .filter((view): view is WorkUnitView => Boolean(view))
      .sort((a, b) => a.queueTier - b.queueTier || b.risk.sortScore - a.risk.sortScore || Date.parse(a.workUnit.createdAt) - Date.parse(b.workUnit.createdAt));
    const reason = status === 'stale' ? (staleReason ?? this.staleReasonText()) : undefined;
    if (stableJson(workUnits) === stableJson(this.snapshot.workUnits) && this.snapshot.status === status && this.snapshot.staleReason === reason) return;
    const inspectedAt = new Date().toISOString();
    this.snapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      seq: this.snapshot.seq + 1,
      generatedAt: inspectedAt,
      workUnits,
      status,
      inspectedAt,
      ...(reason ? { staleReason: reason } : {}),
    };
    const event: WorkspaceEvent = { type: 'workspace.snapshot', seq: this.snapshot.seq, snapshot: this.snapshot };
    for (const subscriber of this.subscribers) subscriber(event);
  }

  private async performRefresh(changedPaths?: readonly string[]): Promise<void> {
    const units = this.store.listWorkUnits();
    const targets = changedPaths === undefined ? units : units.filter((unit) => changedPaths.includes(unit.worktreePath));
    const sessions = await this.collectAgentSessions();
    const byWorktree = this.agents.index(sessions, units.map((unit) => unit.worktreePath));
    const multiUnit = targets.length > 1;
    await mapBounded(targets, INSPECTION_CONCURRENCY, async (unit) => {
      const activity = summarize(byWorktree.get(unit.worktreePath) ?? []);
      try {
        const inspection = await this.git.inspect(unit, this.store.reviewedFiles(unit.id));
        // A reviewed marker is only valid while the patch it reviewed is unchanged.
        this.store.reconcileReviewedHashes(unit.id, inspection.fileHashes ?? new Map(), inspection.change.files.map((file) => file.path));
        this.inspections.set(unit.id, inspection);
        this.inspectionFailures.delete(unit.worktreePath);
        this.watchFailures.delete(unit.worktreePath);
        this.views.set(unit.id, await this.buildView(unit, inspection, activity));
      } catch (error) {
        this.inspections.delete(unit.id);
        this.inspectionFailures.add(unit.worktreePath);
        this.views.set(unit.id, await this.buildUnavailableView(unit, activity, error));
      }
      if (multiUnit) await this.publishSnapshot('inspecting');
    });
    await this.publishSnapshot(this.currentStaleness());
  }

  /** Cheap pass: re-derive agent activity from cached Git evidence. */
  private async refreshAgentActivity(): Promise<void> {
    const units = this.store.listWorkUnits();
    if (units.length === 0) return;
    const sessions = await this.collectAgentSessions();
    const byWorktree = this.agents.index(sessions, units.map((unit) => unit.worktreePath));
    for (const unit of units) {
      const inspection = this.inspections.get(unit.id);
      const existing = this.views.get(unit.id);
      if (!inspection || !existing) continue;
      const activity = summarize(byWorktree.get(unit.worktreePath) ?? []);
      if (stableJson(activity) === stableJson(existing.agentActivity)) continue;
      this.views.set(unit.id, await this.buildView(unit, inspection, activity));
    }
    await this.publishSnapshot(this.currentStaleness());
  }

  private async buildView(unit: WorkUnit, inspected: RepositoryInspection, agentActivity: AgentActivity): Promise<WorkUnitView> {
    // The store is the source of truth for reviewed markers; inspection flags
    // may predate a reconcile that reset a changed patch's review.
    const reviewed = this.store.reviewedFiles(unit.id);
    const change = { ...inspected.change, files: inspected.change.files.map((file) => ({ ...file, reviewed: reviewed.has(file.path) })) };
    const gateDefinitions = this.store.listGateDefinitions(unit.repositoryId);
    const gateProposals = await this.readGateProposals(unit);
    const latestRuns = latestRunsByGate(this.store.listGateRuns(unit.id));
    const visibleRuns = gateDefinitions.flatMap((gate) => {
      const run = latestRuns.get(gate.id);
      if (!run) return [];
      if (run.definitionHash !== gate.definitionHash || run.worktreeFingerprint !== change.fingerprint) return [{ ...run, status: 'stale' as const }];
      return [run];
    });
    const risk = assessRisk({
      change,
      scope: unit.scope,
      baseMissing: !change.baseCommit,
      mergeConflict: inspected.mergeConflict,
      gates: gateDefinitions,
      latestRuns,
    });
    const readiness = mergeReadiness(change, inspected.mergeConflict, gateDefinitions, latestRuns);
    const nextUnit: WorkUnit = {
      ...unit,
      repositoryId: inspected.repositoryId,
      repositoryRoot: inspected.repositoryRoot,
      branch: inspected.branch,
      lifecycle: 'observing',
      updatedAt: change.lastChangedAt,
    };
    this.store.saveWorkUnit(nextUnit);
    const partial = { workUnit: nextUnit, change, agentActivity, risk, mergeReadiness: readiness, gateDefinitions, gateProposals, gateRuns: visibleRuns };
    return { ...partial, attention: attentionFor(partial, inspected.mergeConflict), queueTier: queueTier(partial, inspected.mergeConflict) };
  }

  private async buildUnavailableView(unit: WorkUnit, agentActivity: AgentActivity, error: unknown): Promise<WorkUnitView> {
    const detail = error instanceof Error ? error.message : String(error);
    const unavailable: WorkUnit = { ...unit, lifecycle: 'unavailable' };
    const partial = {
      workUnit: unavailable,
      change: null,
      agentActivity,
      risk: { level: 'high' as const, sortScore: 100, reasons: [{ code: 'worktree.unavailable', label: 'Worktree unavailable', detail, weight: 100 }] },
      mergeReadiness: { status: 'unknown' as const, reasons: [detail] },
      gateDefinitions: this.store.listGateDefinitions(unit.repositoryId),
      gateProposals: [],
      gateRuns: this.store.listGateRuns(unit.id),
    };
    return { ...partial, attention: attentionFor(partial, null), queueTier: 0 };
  }

  private requireUnit(id: string): WorkUnit {
    const unit = this.store.getWorkUnit(id);
    if (!unit) throw new Error('Work unit not found.');
    return unit;
  }

  private async readGateProposals(unit: WorkUnit): Promise<GateProposal[]> {
    const sourcePath = '.review-workspace-gates.json';
    try {
      const parsed = JSON.parse(await readFile(path.join(unit.worktreePath, sourcePath), 'utf8')) as unknown;
      const candidates = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { gates?: unknown }).gates)
          ? (parsed as { gates: unknown[] }).gates
          : [];
      return candidates.flatMap((candidate): GateProposal[] => {
        if (!candidate || typeof candidate !== 'object') return [];
        const value = candidate as Record<string, unknown>;
        if (typeof value.name !== 'string' || typeof value.program !== 'string') return [];
        const normalized: GateDefinitionInput = {
          name: value.name.trim(),
          program: value.program.trim(),
          args: Array.isArray(value.args) ? value.args.filter((item): item is string => typeof item === 'string') : [],
          ...(typeof value.cwd === 'string' && value.cwd.trim() ? { cwd: value.cwd.trim() } : {}),
          envAllowlist: Array.isArray(value.envAllowlist) ? value.envAllowlist.filter((item): item is string => typeof item === 'string') : [],
          timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : 600_000,
          required: typeof value.required === 'boolean' ? value.required : true,
        };
        if (!normalized.name || !normalized.program) return [];
        return [{ ...normalized, sourcePath, proposalHash: sha256(stableJson(normalized)) }];
      });
    } catch {
      return [];
    }
  }
}
