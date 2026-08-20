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
} from '@review-workspace/schema';
import { WORKSPACE_SCHEMA_VERSION } from '@review-workspace/schema';
import { AgentActivityObserver, summarize } from './agent-activity.js';
import { sha256, stableJson } from './hash.js';
import { GitCliRepositoryAdapter } from './git-adapter.js';
import { LocalProcessGateProvider } from './gate-provider.js';
import { assessRisk } from './risk.js';
import { WorkspaceStore } from './store.js';
import { inferPathTokens } from './task-scope.js';

type Subscriber = (event: WorkspaceEvent) => void;

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
  private readonly git = new GitCliRepositoryAdapter();
  private readonly gates = new LocalProcessGateProvider();
  private readonly agents = new AgentActivityObserver();
  private readonly subscribers = new Set<Subscriber>();
  private snapshot: WorkspaceSnapshot = { schemaVersion: WORKSPACE_SCHEMA_VERSION, seq: 0, generatedAt: new Date().toISOString(), workUnits: [] };
  private watcher: FSWatcher | undefined;
  private interval: NodeJS.Timeout | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private refreshing: Promise<WorkspaceSnapshot> | undefined;
  /** Paths the watcher refused, reported once each instead of crashing the host. */
  private readonly watchFailures = new Set<string>();

  constructor(readonly store: WorkspaceStore) {}

  current(): WorkspaceSnapshot {
    return this.snapshot;
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
    this.watcher.on('all', () => this.scheduleRefresh());
    // One unreadable path must not take the host down with it. Windows raises EPERM
    // on realpath for locked directories, and chokidar surfaces that as an error
    // event that would otherwise go unhandled and kill the process. Git inspection
    // still covers the worktree; only change notifications are lost for that path.
    this.watcher.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (this.watchFailures.has(message)) return;
      this.watchFailures.add(message);
      process.stderr.write(`Watch degraded to polling for one path: ${message}\n`);
    });
    this.interval = setInterval(() => void this.refresh(), 15_000);
    this.interval.unref();
    await this.refresh();
  }

  async stop(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    if (this.debounce) clearTimeout(this.debounce);
    await this.watcher?.close();
    this.store.close();
  }

  private scheduleRefresh(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.refresh(), 500);
    this.debounce.unref();
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
    await this.refresh();
    return workUnit;
  }

  async unregister(id: string): Promise<boolean> {
    const unit = this.store.getWorkUnit(id);
    const removed = this.store.unregisterWorkUnit(id);
    if (removed && unit) await this.watcher?.unwatch(unit.worktreePath);
    await this.refresh();
    return removed;
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
    await this.refresh();
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
    await this.refresh();
    return run;
  }

  async removeGate(workUnitId: string, gateId: string): Promise<boolean> {
    const unit = this.requireUnit(workUnitId);
    const gate = this.store.getGateDefinition(gateId);
    if (!gate || gate.repositoryId !== unit.repositoryId) return false;
    const removed = this.store.removeGateDefinition(gateId);
    await this.refresh();
    return removed;
  }

  async setReviewed(workUnitId: string, input: ReviewedFilesInput): Promise<void> {
    this.requireUnit(workUnitId);
    this.store.setFilesReviewed(workUnitId, input.files, input.reviewed);
    await this.refresh();
  }

  async diff(workUnitId: string): Promise<string> {
    const unit = this.requireUnit(workUnitId);
    await this.git.inspect(unit, this.store.reviewedFiles(unit.id));
    return this.git.getCachedDiff(workUnitId) ?? '';
  }

  async refresh(): Promise<WorkspaceSnapshot> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.performRefresh().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  /** Agent observation is advisory; a failure here must not break the repo channel. */
  private async collectAgentSessions(): Promise<AgentSession[]> {
    try {
      return await this.agents.collect();
    } catch {
      return [];
    }
  }

  private async performRefresh(): Promise<WorkspaceSnapshot> {
    const units = this.store.listWorkUnits();
    const byWorktree = this.agents.index(await this.collectAgentSessions(), units.map((unit) => unit.worktreePath));
    const views = await Promise.all(units.map((unit) => this.buildView(unit, summarize(byWorktree.get(unit.worktreePath) ?? []))));
    views.sort((a, b) => a.queueTier - b.queueTier || b.risk.sortScore - a.risk.sortScore || Date.parse(a.workUnit.createdAt) - Date.parse(b.workUnit.createdAt));
    if (stableJson(views) === stableJson(this.snapshot.workUnits)) return this.snapshot;
    this.snapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      seq: this.snapshot.seq + 1,
      generatedAt: new Date().toISOString(),
      workUnits: views,
    };
    const event: WorkspaceEvent = { type: 'workspace.snapshot', seq: this.snapshot.seq, snapshot: this.snapshot };
    for (const subscriber of this.subscribers) subscriber(event);
    return this.snapshot;
  }

  private async buildView(unit: WorkUnit, agentActivity: AgentActivity): Promise<WorkUnitView> {
    try {
      const inspected = await this.git.inspect(unit, this.store.reviewedFiles(unit.id));
      const gateDefinitions = this.store.listGateDefinitions(unit.repositoryId);
      const gateProposals = await this.readGateProposals(unit);
      const latestRuns = latestRunsByGate(this.store.listGateRuns(unit.id));
      const visibleRuns = gateDefinitions.flatMap((gate) => {
        const run = latestRuns.get(gate.id);
        if (!run) return [];
        if (run.definitionHash !== gate.definitionHash || run.worktreeFingerprint !== inspected.change.fingerprint) return [{ ...run, status: 'stale' as const }];
        return [run];
      });
      const risk = assessRisk({
        change: inspected.change,
        scope: unit.scope,
        baseMissing: !inspected.change.baseCommit,
        mergeConflict: inspected.mergeConflict,
        gates: gateDefinitions,
        latestRuns,
      });
      const readiness = mergeReadiness(inspected.change, inspected.mergeConflict, gateDefinitions, latestRuns);
      const nextUnit: WorkUnit = {
        ...unit,
        repositoryId: inspected.repositoryId,
        repositoryRoot: inspected.repositoryRoot,
        branch: inspected.branch,
        lifecycle: inspected.change.files.length > 0 ? 'ready-for-review' : readiness.status === 'blocked' ? 'blocked' : 'observing',
        updatedAt: inspected.change.lastChangedAt,
      };
      this.store.saveWorkUnit(nextUnit);
      const partial = { workUnit: nextUnit, change: inspected.change, agentActivity, risk, mergeReadiness: readiness, gateDefinitions, gateProposals, gateRuns: visibleRuns };
      return { ...partial, attention: attentionFor(partial, inspected.mergeConflict), queueTier: queueTier(partial, inspected.mergeConflict) };
    } catch (error) {
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
