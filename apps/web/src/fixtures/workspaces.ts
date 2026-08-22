import { WORKSPACE_SCHEMA_VERSION, type AgentActivity, type AgentLabel, type AttentionItem, type ChangeFile, type ChangeSummary, type GateDefinition, type GateProposal, type GateRun, type MergeReadiness, type RiskAssessment, type WorkUnit, type WorkUnitLifecycle, type WorkUnitView, type WorkUnitVisibility, type WorkspaceSnapshot } from '@review-workspace/schema';

let serial = 0;
const nextId = (): string => `unit-${++serial}`;
const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

const UNIT_TASK = 'Add retry handling to the API client';
const WORKTREE = 'C:\\projects\\repo\\worktrees\\api-retry';
const FINGERPRINT = 'ff51fce2d66f0d1d3c01f0f7a7f1c2f3f4f5f6f7';

interface ViewOptions {
  id?: string;
  task?: string;
  branch?: string;
  lifecycle?: WorkUnitLifecycle;
  visibility?: WorkUnitVisibility;
  repositoryId?: string;
  repositoryRoot?: string;
  worktreePath?: string;
  agentLabel?: AgentLabel;
  createdMinutesAgo?: number;
  updatedMinutesAgo?: number;
  change?: ChangeSummary | null;
  agent?: AgentActivity;
  risk?: RiskAssessment;
  readiness?: MergeReadiness;
  gates?: GateDefinition[];
  runs?: GateRun[];
  proposals?: GateProposal[];
  attention?: AttentionItem[];
  queueTier?: number;
}

const DEFAULT_RISK: RiskAssessment = { level: 'low', sortScore: 0, reasons: [] };
const NO_AGENT: AgentActivity = { state: 'unknown', sessions: [] };
const IDLE_AGENT: AgentActivity = {
  state: 'idle',
  lastActivityAt: minutesAgo(12),
  sessions: [{ sessionId: 'abc123def456', agentLabel: 'claude-code', cwd: WORKTREE, state: 'idle', lastActivityAt: minutesAgo(12), lastTurnComplete: true }],
};

export function gate(id: string, name: string, args = ['test']): GateDefinition {
  return {
    id, repositoryId: 'repo-1', name, program: 'pnpm.cmd', args,
    envAllowlist: [], timeoutMs: 600_000, required: true, definitionHash: `def-${id}`, approvedAt: minutesAgo(300),
  };
}

export function run(gateId: string, status: GateRun['status'], fingerprint = FINGERPRINT, output = ''): GateRun {
  return {
    id: `run-${gateId}`, gateId, workUnitId: '', status, definitionHash: `def-${gateId}`,
    worktreeFingerprint: fingerprint, startedAt: minutesAgo(4), finishedAt: minutesAgo(3), exitCode: status === 'passed' ? 0 : 1, durationMs: 48_000, output,
  };
}

function proposal(name: string, program: string, args: string[], hash: string): GateProposal {
  return { name, program, args, cwd: '.', timeoutMs: 600_000, required: true, proposalHash: hash, sourcePath: '.review-workspace-gates.json' };
}

function changeFiles(items: ChangeFile[], additions = 0, deletions = 0): ChangeSummary {
  return {
    baseCommit: 'b1c0de', headCommit: 'b0ba', branch: 'feature/api-retry', dirty: false,
    ahead: 1, behind: 0, additions, deletions, files: items,
    topLevelAreas: [...new Set(items.map((file) => file.path.split('/')[0] ?? file.path))],
    trackedDiffHash: 'tracked', untrackedContentHash: 'untracked', fingerprint: FINGERPRINT, lastChangedAt: minutesAgo(5),
  };
}

function attention(workUnitId: string, items: Omit<AttentionItem, 'id' | 'workUnitId'>[]): AttentionItem[] {
  return items.map((item, index) => ({ ...item, id: `${workUnitId}:${index}`, workUnitId }));
}

export function buildView(options: ViewOptions): WorkUnitView {
  const workUnit: WorkUnit = {
    id: options.id ?? nextId(),
    kind: 'unmanaged',
    task: options.task ?? UNIT_TASK,
    ...(options.agentLabel ? { agentLabel: options.agentLabel } : { agentLabel: 'claude-code' }),
    repositoryId: options.repositoryId ?? 'repo-1',
    repositoryRoot: options.repositoryRoot ?? 'C:\\projects\\repo',
    worktreePath: options.worktreePath ?? WORKTREE,
    branch: options.branch ?? 'feature/api-retry',
    baseRef: 'main',
    lifecycle: options.lifecycle ?? 'observing',
    visibility: options.visibility ?? 'active',
    scope: { allowedGlobs: ['src/api/**'], inferredPathTokens: [], confirmed: true },
    createdAt: minutesAgo(options.createdMinutesAgo ?? 120),
    updatedAt: minutesAgo(options.updatedMinutesAgo ?? 5),
  };
  const change = options.change === undefined ? changeFiles([
    { path: 'src/api/client.ts', status: 'modified', additions: 34, deletions: 2, binary: false, reviewed: false },
    { path: 'tests/api/client.test.ts', status: 'added', additions: 62, deletions: 0, binary: false, reviewed: false },
  ], 96, 2) : options.change;
  const readiness: MergeReadiness = options.readiness ?? (change
    ? { status: 'ready', reasons: ['The branch is clean, conflict-free, ahead of base, and all required trusted gates passed.'] }
    : { status: 'unknown', reasons: ['The configured base reference does not resolve.'] });
  return {
    workUnit,
    change,
    agentActivity: options.agent ?? IDLE_AGENT,
    risk: options.risk ?? DEFAULT_RISK,
    mergeReadiness: readiness,
    gateDefinitions: options.gates ?? [],
    gateProposals: options.proposals ?? [],
    gateRuns: options.runs ?? [],
    attention: options.attention ?? attention(workUnit.id, [{ kind: 'ready-for-review', severity: 'low', title: 'Changes ready for review', detail: `${change?.files.length ?? 0} changed file${(change?.files.length ?? 0) === 1 ? '' : 's'}.` }]),
    queueTier: options.queueTier ?? 2,
  };
}

export function snapshot(views: WorkUnitView[]): WorkspaceSnapshot {
  return { schemaVersion: WORKSPACE_SCHEMA_VERSION, seq: 1, generatedAt: minutesAgo(0), workUnits: views };
}

export interface Fixture {
  name: string;
  description: string;
  snapshot: WorkspaceSnapshot;
  /** Optional unified-diff text served by the harness instead of the real host. */
  diff?: string;
}

export const fixtures: Fixture[] = [
  {
    name: 'Empty workspace',
    description: 'No registered work units. The queue shows its empty state and the detail pane shows the placeholder.',
    snapshot: snapshot([]),
  },
  {
    name: 'One healthy work unit',
    description: 'A clean, conflict-free change with a passing required gate and an idle agent. Ready to merge.',
    snapshot: snapshot([
      buildView({
        gates: [gate('tests', 'Unit tests')],
        runs: [run('tests', 'passed')],
      }),
    ]),
  },
  {
    name: 'Blocked work unit',
    description: 'A merge conflict with uncommitted changes. Blocked and raised to the top of the queue.',
    snapshot: snapshot([
      buildView({
        task: 'Migrate auth sessions to a shared store',
        change: changeFiles([
          { path: 'src/auth/session.ts', status: 'modified', additions: 18, deletions: 4, binary: false, reviewed: false },
        ], 18, 4),
        risk: { level: 'high', sortScore: 85, reasons: [
          { code: 'git.conflict', label: 'Conflicts with the base branch', detail: 'Git reports a merge conflict without modifying the worktree.', weight: 35 },
          { code: 'change.sensitive', label: 'Touches sensitive project surfaces', detail: 'src/auth/session.ts', weight: 22 },
        ] },
        readiness: { status: 'blocked', reasons: ['The branch conflicts with the configured base reference.', 'The worktree contains uncommitted changes.'] },
        attention: attention('blocked', [
          { kind: 'merge-conflict', severity: 'high', title: 'Resolve merge conflict', detail: 'The clean branch does not merge into the configured base ref.' },
          { kind: 'ready-for-review', severity: 'high', title: 'Changes ready for review', detail: '1 changed file.' },
        ]),
        queueTier: 0,
      }),
    ]),
  },
  {
    name: 'Agent working',
    description: 'An open Claude Code turn is in progress. The unit drops to the bottom of the queue and attention says review may be premature.',
    snapshot: snapshot([
      buildView({
        agent: {
          state: 'working',
          sessions: [{ sessionId: 'abc123def456', agentLabel: 'claude-code', cwd: WORKTREE, state: 'working', lastActivityAt: minutesAgo(1), lastTurnComplete: false }],
        },
        attention: attention('working', [
          { kind: 'agent-working', severity: 'low', title: 'Agent still working', detail: 'Claude Code has an open turn here. Review may be premature.' },
          { kind: 'ready-for-review', severity: 'low', title: 'Changes ready for review', detail: '2 changed files.' },
        ]),
        queueTier: 4,
      }),
    ]),
  },
  {
    name: 'Agent stalled',
    description: 'An open turn stopped writing past the staleness threshold. Raised in the queue and flagged.',
    snapshot: snapshot([
      buildView({
        agent: {
          state: 'stalled',
          sessions: [{ sessionId: 'abc123def456', agentLabel: 'codex', cwd: WORKTREE, state: 'stalled', lastActivityAt: minutesAgo(45), lastTurnComplete: false }],
        },
        attention: attention('stalled', [
          { kind: 'agent-stalled', severity: 'medium', title: 'Agent stopped mid-turn', detail: 'Codex started a turn and stopped writing. It may have been interrupted, or be inside a long tool call.' },
          { kind: 'ready-for-review', severity: 'low', title: 'Changes ready for review', detail: '2 changed files.' },
        ]),
        queueTier: 1,
      }),
    ]),
  },
  {
    name: 'Agent no signal',
    description: 'An active unit with no readable agent transcript. The workspace reports no signal rather than idle: it cannot tell an absent agent from a changed transcript format.',
    snapshot: snapshot([
      buildView({
        agent: NO_AGENT,
        attention: attention('no-signal', [
          { kind: 'ready-for-review', severity: 'low', title: 'Changes ready for review', detail: '2 changed files.' },
        ]),
        queueTier: 2,
      }),
    ]),
  },
  {
    name: 'Archived work',
    description: 'An operator-archived work unit. Retained but no longer observed; the queue treats it as quiet.',
    snapshot: snapshot([
      buildView({
        visibility: 'archived',
        task: 'Retired: publish script experiment',
        branch: 'experiment/publish',
        change: changeFiles([]),
        agent: NO_AGENT,
        readiness: { status: 'unknown', reasons: ['The branch has no commits ahead of the base reference.'] },
        attention: [],
        queueTier: 3,
      }),
    ]),
  },
  {
    name: 'Missing worktree',
    description: 'The registered path cannot be inspected. The work unit stays registered and degrades to unavailable.',
    snapshot: snapshot([
      buildView({
        lifecycle: 'unavailable',
        change: null,
        agent: NO_AGENT,
        risk: { level: 'high', sortScore: 100, reasons: [{ code: 'worktree.unavailable', label: 'Worktree unavailable', detail: 'EACCES: permission denied, scandir C:\\projects\\repo\\worktrees\\api-retry', weight: 100 }] },
        readiness: { status: 'unknown', reasons: ['EACCES: permission denied, scandir C:\\projects\\repo\\worktrees\\api-retry'] },
        attention: attention('missing', [
          { kind: 'unavailable', severity: 'high', title: 'Worktree unavailable', detail: 'Git inspection failed for this registered path.' },
        ]),
        queueTier: 0,
      }),
    ]),
  },
  {
    name: '500 changed files',
    description: 'A large generated change. The queue and change list render without a diff row explosion; the unified diff stays bounded.',
    snapshot: snapshot([
      buildView({
        task: 'Replay generated API bindings',
        change: changeFiles(
          Array.from({ length: 500 }, (_, index) => ({ path: `dist/gen/schema-${String(index).padStart(3, '0')}.d.ts`, status: 'added' as const, additions: 1, deletions: 0, binary: false, reviewed: false })),
          500, 0,
        ),
        risk: { level: 'medium', sortScore: 46, reasons: [
          { code: 'change.large', label: 'Large review surface', detail: '500 files and 500 changed lines.', weight: 18 },
          { code: 'scope.outside-glob', label: 'Outside stated scope', detail: '500 changed files do not match the confirmed scope.', weight: 28 },
        ] },
        gates: [gate('tests', 'Unit tests')],
        runs: [run('tests', 'passed')],
        attention: attention('large', [
          { kind: 'ready-for-review', severity: 'medium', title: 'Changes ready for review', detail: '500 changed files.' },
        ]),
        queueTier: 2,
      }),
    ]),
    diff: [
      'diff --git a/dist/gen/schema-000.d.ts b/dist/gen/schema-000.d.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/dist/gen/schema-000.d.ts',
      '@@ -0,0 +1,1 @@',
      '+export type GenSchema000 = unknown;',
    ].join('\n'),
  },
  {
    name: 'Missing checks',
    description: 'A required gate is defined but has no run yet. Merge-readiness is blocked until the gate produces a current result.',
    snapshot: snapshot([
      buildView({
        gates: [gate('tests', 'Unit tests')],
        runs: [],
        risk: { level: 'low', sortScore: 16, reasons: [{ code: 'gate.stale.tests', label: 'Unit tests needs a current result', detail: 'The trusted gate has not passed for this exact diff and definition.', weight: 16 }] },
        readiness: { status: 'blocked', reasons: ['Unit tests has no current result for this diff.'] },
        attention: attention('missing-checks', [
          { kind: 'gate-stale', severity: 'medium', title: 'Unit tests needs a current result', detail: 'The trusted gate has not passed for this exact diff and definition.' },
        ]),
        queueTier: 2,
      }),
    ]),
  },
  {
    name: 'Failed checks',
    description: 'A required gate ran and did not pass against the current diff. Blocked and raised to the top.',
    snapshot: snapshot([
      buildView({
        gates: [gate('tests', 'Unit tests')],
        runs: [run('tests', 'failed')],
        risk: { level: 'low', sortScore: 28, reasons: [{ code: 'gate.failed.tests', label: 'Unit tests failed', detail: 'A required trusted gate did not pass.', weight: 28 }] },
        readiness: { status: 'blocked', reasons: ['Unit tests did not pass.'] },
        attention: attention('failed-checks', [
          { kind: 'gate-failed', severity: 'high', title: 'Unit tests failed', detail: 'A required trusted gate did not pass.' },
        ]),
        queueTier: 0,
      }),
    ]),
  },
  {
    name: 'Passed checks',
    description: 'All required gates passed against the current diff fingerprint. Ready.',
    snapshot: snapshot([
      buildView({
        gates: [gate('tests', 'Unit tests'), gate('lint', 'Lint')],
        runs: [run('tests', 'passed'), run('lint', 'passed')],
        attention: attention('passed-checks', [
          { kind: 'ready-for-review', severity: 'low', title: 'Changes ready for review', detail: '2 changed files.' },
        ]),
        queueTier: 2,
      }),
    ]),
  },
  {
    name: 'Check proposal pending',
    description: 'A repository proposes a trusted check. It stays inert until the operator approves it and never runs automatically.',
    snapshot: snapshot([
      buildView({
        id: 'prop-1',
        task: 'Add signing to webhook delivery',
        repositoryId: 'repo-proposals',
        repositoryRoot: 'C:\\projects\\webhooks',
        worktreePath: 'C:\\projects\\webhooks\\worktrees\\signing',
        branch: 'feature/webhook-signing',
        gates: [],
        proposals: [proposal('Unit tests', 'pnpm.cmd', ['test'], 'aa11bb22cc33')],
        readiness: { status: 'blocked', reasons: ['No required trusted gates are configured.'] },
        attention: attention('prop-1', [
          { kind: 'gate-stale', severity: 'medium', title: 'Unit tests needs a current result', detail: 'The trusted gate has not passed for this exact diff and definition.' },
        ]),
        queueTier: 2,
      }),
    ]),
  },
  {
    name: 'Running checks',
    description: 'One required check is currently executing while another has passed. Running is shown as its own distinct state.',
    snapshot: snapshot([
      buildView({
        id: 'run-1',
        gates: [gate('tests', 'Unit tests'), gate('lint', 'Lint', ['lint'])],
        runs: [run('tests', 'passed'), run('lint', 'running')],
        risk: { level: 'low', sortScore: 28, reasons: [{ code: 'gate.failed.lint', label: 'Lint failed', detail: 'A required trusted gate did not pass.', weight: 28 }] },
        readiness: { status: 'blocked', reasons: ['Lint did not pass.'] },
        attention: attention('run-1', [
          { kind: 'gate-failed', severity: 'high', title: 'Lint failed', detail: 'A required trusted gate did not pass.' },
        ]),
        queueTier: 0,
      }),
    ]),
  },
  {
    name: 'Stale checks',
    description: 'A gate result exists but its fingerprint no longer matches the diff. The result proves nothing about the current change.',
    snapshot: snapshot([
      buildView({
        gates: [gate('tests', 'Unit tests')],
        runs: [run('tests', 'stale', 'old-fingerprint')],
        risk: { level: 'low', sortScore: 16, reasons: [{ code: 'gate.stale.tests', label: 'Unit tests needs a current result', detail: 'The trusted gate has not passed for this exact diff and definition.', weight: 16 }] },
        readiness: { status: 'blocked', reasons: ['Unit tests has no current result for this diff.'] },
        attention: attention('stale-checks', [
          { kind: 'gate-stale', severity: 'medium', title: 'Unit tests needs a current result', detail: 'The trusted gate has not passed for this exact diff and definition.' },
        ]),
        queueTier: 2,
      }),
    ]),
  },
  {
    name: '19 work units across repositories',
    description: 'A busy workspace: several repos, a mix of attention, in-progress, ready, needs-review, clean, and archived work units. Exercises grouping, counts, search, and archive.',
    snapshot: snapshot([
      // api-gateway: attention-heavy.
      buildView({ id: 'mix-01', task: 'Conflicting route refactor', repositoryId: 'repo-api', repositoryRoot: 'C:\\projects\\api-gateway', worktreePath: 'C:\\projects\\api-gateway\\worktrees\\route-refactor', branch: 'feature/route-refactor', updatedMinutesAgo: 15, change: changeFiles([{ path: 'src/routes/index.ts', status: 'modified', additions: 22, deletions: 9, binary: false, reviewed: false }], 22, 9), risk: { level: 'high', sortScore: 85, reasons: [{ code: 'git.conflict', label: 'Conflicts with the base branch', detail: 'Git reports a merge conflict without modifying the worktree.', weight: 35 }, { code: 'change.sensitive', label: 'Touches sensitive project surfaces', detail: 'src/routes/index.ts', weight: 22 }] }, readiness: { status: 'blocked', reasons: ['The branch conflicts with the configured base reference.'] }, attention: attention('mix-01', [{ kind: 'merge-conflict', severity: 'high', title: 'Resolve merge conflict', detail: 'The clean branch does not merge into the configured base ref.' }]), queueTier: 0 }),
      buildView({ id: 'mix-02', task: 'Fix failing contract tests', repositoryId: 'repo-api', repositoryRoot: 'C:\\projects\\api-gateway', worktreePath: 'C:\\projects\\api-gateway\\worktrees\\contract-fix', branch: 'fix/contract-tests', updatedMinutesAgo: 55, gates: [gate('tests', 'Unit tests')], runs: [run('tests', 'failed')], risk: { level: 'low', sortScore: 28, reasons: [{ code: 'gate.failed.tests', label: 'Unit tests failed', detail: 'A required trusted gate did not pass.', weight: 28 }] }, readiness: { status: 'blocked', reasons: ['Unit tests did not pass.'] }, attention: attention('mix-02', [{ kind: 'gate-failed', severity: 'high', title: 'Unit tests failed', detail: 'A required trusted gate did not pass.' }]), queueTier: 0 }),
      buildView({ id: 'mix-03', task: 'Rate limiting middleware', repositoryId: 'repo-api', repositoryRoot: 'C:\\projects\\api-gateway', worktreePath: 'C:\\projects\\api-gateway\\worktrees\\rate-limit', branch: 'feature/rate-limit', updatedMinutesAgo: 190, gates: [gate('tests', 'Unit tests')], runs: [run('tests', 'passed')], attention: attention('mix-03', [{ kind: 'ready-for-review', severity: 'low', title: 'Changes ready for review', detail: '2 changed files.' }]), queueTier: 2 }),
      buildView({ id: 'mix-04', task: 'OpenAPI response envelopes', repositoryId: 'repo-api', repositoryRoot: 'C:\\projects\\api-gateway', worktreePath: 'C:\\projects\\api-gateway\\worktrees\\openapi-envelopes', branch: 'feature/envelopes', updatedMinutesAgo: 30, gates: [gate('tests', 'Unit tests')], runs: [], risk: { level: 'low', sortScore: 16, reasons: [{ code: 'gate.stale.tests', label: 'Unit tests needs a current result', detail: 'The trusted gate has not passed for this exact diff and definition.', weight: 16 }] }, readiness: { status: 'blocked', reasons: ['Unit tests has no current result for this diff.'] }, attention: attention('mix-04', [{ kind: 'gate-stale', severity: 'medium', title: 'Unit tests needs a current result', detail: 'The trusted gate has not passed for this exact diff and definition.' }]), queueTier: 2 }),
      buildView({ id: 'mix-05', task: 'Tracing headers, turn open', repositoryId: 'repo-api', repositoryRoot: 'C:\\projects\\api-gateway', worktreePath: 'C:\\projects\\api-gateway\\worktrees\\tracing', branch: 'feature/tracing', updatedMinutesAgo: 3, agent: { state: 'working', sessions: [{ sessionId: 'sess-05', agentLabel: 'codex', cwd: 'C:\\projects\\api-gateway\\worktrees\\tracing', state: 'working', lastActivityAt: minutesAgo(1), lastTurnComplete: false }] }, readiness: { status: 'unknown', reasons: ['No required trusted gates are configured.'] }, attention: attention('mix-05', [{ kind: 'agent-working', severity: 'low', title: 'Agent still working', detail: 'Codex has an open turn here. Review may be premature.' }]), queueTier: 4 }),
      buildView({ id: 'mix-06', task: 'Webhook signature retry, stalled', repositoryId: 'repo-api', repositoryRoot: 'C:\\projects\\api-gateway', worktreePath: 'C:\\projects\\api-gateway\\worktrees\\webhook-retry', branch: 'fix/webhook-retry', updatedMinutesAgo: 48, agent: { state: 'stalled', sessions: [{ sessionId: 'sess-06', agentLabel: 'claude-code', cwd: 'C:\\projects\\api-gateway\\worktrees\\webhook-retry', state: 'stalled', lastActivityAt: minutesAgo(48), lastTurnComplete: false }] }, readiness: { status: 'unknown', reasons: ['No required trusted gates are configured.'] }, attention: attention('mix-06', [{ kind: 'agent-stalled', severity: 'medium', title: 'Agent stopped mid-turn', detail: 'Claude Code started a turn and stopped writing.' }]), queueTier: 1 }),
      buildView({ id: 'mix-07', task: 'Retired cache invalidation spike', visibility: 'archived', repositoryId: 'repo-api', repositoryRoot: 'C:\\projects\\api-gateway', worktreePath: 'C:\\projects\\api-gateway\\worktrees\\cache-spike', branch: 'spike/cache-invalidation', updatedMinutesAgo: 5000, createdMinutesAgo: 5200, change: changeFiles([]), agent: NO_AGENT, readiness: { status: 'unknown', reasons: ['Archived work unit.'] }, attention: [], queueTier: 3 }),
      // admin-console: medium traffic.
      buildView({ id: 'mix-08', task: 'Bulk user import flow', repositoryId: 'repo-admin', repositoryRoot: 'C:\\projects\\admin-console', worktreePath: 'C:\\projects\\admin-console\\worktrees\\bulk-import', branch: 'feature/bulk-import', updatedMinutesAgo: 25, gates: [gate('tests', 'Unit tests'), gate('lint', 'Lint')], runs: [run('tests', 'passed'), run('lint', 'passed')], attention: attention('mix-08', [{ kind: 'ready-for-review', severity: 'low', title: 'Changes ready for review', detail: '8 changed files.' }]), queueTier: 2 }),
      buildView({ id: 'mix-09', task: 'Permissions matrix cleanup', repositoryId: 'repo-admin', repositoryRoot: 'C:\\projects\\admin-console', worktreePath: 'C:\\projects\\admin-console\\worktrees\\permissions', branch: 'chore/permissions', updatedMinutesAgo: 300, change: changeFiles([{ path: 'src/roles/matrix.ts', status: 'modified', additions: 12, deletions: 6, binary: false, reviewed: false }, { path: 'tests/roles/matrix.test.ts', status: 'modified', additions: 9, deletions: 2, binary: false, reviewed: false }], 21, 8), risk: { level: 'medium', sortScore: 30, reasons: [{ code: 'change.sensitive', label: 'Touches sensitive project surfaces', detail: 'src/roles/matrix.ts', weight: 22 }, { code: 'change.destructive', label: 'Deletes or renames files', detail: '0 files deleted or renamed.', weight: 16 }] }, readiness: { status: 'unknown', reasons: ['No required trusted gates are configured.'] }, attention: attention('mix-09', [{ kind: 'ready-for-review', severity: 'medium', title: 'Changes ready for review', detail: '2 changed files.' }]), queueTier: 2 }),
      buildView({ id: 'mix-10', task: 'Audit log export, stalled', repositoryId: 'repo-admin', repositoryRoot: 'C:\\projects\\admin-console', worktreePath: 'C:\\projects\\admin-console\\worktrees\\audit-export', branch: 'feature/audit-export', updatedMinutesAgo: 70, agent: { state: 'stalled', sessions: [{ sessionId: 'sess-10', agentLabel: 'claude-code', cwd: 'C:\\projects\\admin-console\\worktrees\\audit-export', state: 'stalled', lastActivityAt: minutesAgo(70), lastTurnComplete: false }] }, readiness: { status: 'unknown', reasons: ['No required trusted gates are configured.'] }, attention: attention('mix-10', [{ kind: 'agent-stalled', severity: 'medium', title: 'Agent stopped mid-turn', detail: 'Claude Code started a turn and stopped writing.' }]), queueTier: 1 }),
      buildView({ id: 'mix-11', task: 'Session store migration, turn open', repositoryId: 'repo-admin', repositoryRoot: 'C:\\projects\\admin-console', worktreePath: 'C:\\projects\\admin-console\\worktrees\\session-store', branch: 'feature/session-store', updatedMinutesAgo: 8, agent: { state: 'working', sessions: [{ sessionId: 'sess-11', agentLabel: 'codex', cwd: 'C:\\projects\\admin-console\\worktrees\\session-store', state: 'working', lastActivityAt: minutesAgo(2), lastTurnComplete: false }] }, readiness: { status: 'unknown', reasons: ['No required trusted gates are configured.'] }, attention: attention('mix-11', [{ kind: 'agent-working', severity: 'low', title: 'Agent still working', detail: 'Codex has an open turn here. Review may be premature.' }]), queueTier: 4 }),
      buildView({ id: 'mix-12', task: 'Retired login theming spike', visibility: 'archived', repositoryId: 'repo-admin', repositoryRoot: 'C:\\projects\\admin-console', worktreePath: 'C:\\projects\\admin-console\\worktrees\\login-theme', branch: 'spike/login-theme', updatedMinutesAgo: 9000, createdMinutesAgo: 9200, change: changeFiles([]), agent: NO_AGENT, readiness: { status: 'unknown', reasons: ['Archived work unit.'] }, attention: [], queueTier: 3 }),
      // cli-tool: quiet.
      buildView({ id: 'mix-13', task: 'Add dry-run flag', repositoryId: 'repo-cli', repositoryRoot: 'C:\\projects\\cli-tool', worktreePath: 'C:\\projects\\cli-tool\\worktrees\\dry-run', branch: 'feature/dry-run', updatedMinutesAgo: 120, gates: [gate('tests', 'Unit tests')], runs: [run('tests', 'passed')], attention: attention('mix-13', [{ kind: 'ready-for-review', severity: 'low', title: 'Changes ready for review', detail: '1 changed file.' }]), queueTier: 2 }),
      buildView({ id: 'mix-14', task: 'Color output parity', repositoryId: 'repo-cli', repositoryRoot: 'C:\\projects\\cli-tool', worktreePath: 'C:\\projects\\cli-tool\\worktrees\\color-parity', branch: 'fix/color-parity', updatedMinutesAgo: 200, change: changeFiles([{ path: 'src/render.ts', status: 'modified', additions: 17, deletions: 4, binary: false, reviewed: false }], 17, 4), readiness: { status: 'unknown', reasons: ['No required trusted gates are configured.'] }, attention: attention('mix-14', [{ kind: 'ready-for-review', severity: 'low', title: 'Changes ready for review', detail: '1 changed file.' }]), queueTier: 2 }),
      buildView({ id: 'mix-15', task: 'Stale help text, stalled', repositoryId: 'repo-cli', repositoryRoot: 'C:\\projects\\cli-tool', worktreePath: 'C:\\projects\\cli-tool\\worktrees\\help-text', branch: 'docs/help-text', updatedMinutesAgo: 90, agent: { state: 'stalled', sessions: [{ sessionId: 'sess-15', agentLabel: 'claude-code', cwd: 'C:\\projects\\cli-tool\\worktrees\\help-text', state: 'stalled', lastActivityAt: minutesAgo(90), lastTurnComplete: false }] }, readiness: { status: 'unknown', reasons: ['No required trusted gates are configured.'] }, attention: attention('mix-15', [{ kind: 'agent-stalled', severity: 'medium', title: 'Agent stopped mid-turn', detail: 'Claude Code started a turn and stopped writing.' }]), queueTier: 1 }),
      buildView({ id: 'mix-16', task: 'Retired emoji flag spike', visibility: 'archived', repositoryId: 'repo-cli', repositoryRoot: 'C:\\projects\\cli-tool', worktreePath: 'C:\\projects\\cli-tool\\worktrees\\emoji-flag', branch: 'spike/emoji-flag', updatedMinutesAgo: 12000, createdMinutesAgo: 12200, change: changeFiles([]), agent: NO_AGENT, readiness: { status: 'unknown', reasons: ['Archived work unit.'] }, attention: [], queueTier: 3 }),
      buildView({ id: 'mix-17', task: 'Cache invalidation follow-up', repositoryId: 'repo-api', repositoryRoot: 'C:\\projects\\api-gateway', worktreePath: 'C:\\projects\\api-gateway\\worktrees\\cache-followup', branch: 'chore/cache-followup', updatedMinutesAgo: 600, change: changeFiles([]), agent: NO_AGENT, readiness: { status: 'unknown', reasons: ['The branch has no commits ahead of the base reference.'] }, attention: [], queueTier: 3 }),
      buildView({ id: 'mix-18', task: 'Invite flow validation copy', repositoryId: 'repo-admin', repositoryRoot: 'C:\\projects\\admin-console', worktreePath: 'C:\\projects\\admin-console\\worktrees\\invite-copy', branch: 'fix/invite-copy', updatedMinutesAgo: 240, change: changeFiles([{ path: 'src/invites/messages.ts', status: 'modified', additions: 6, deletions: 3, binary: false, reviewed: false }], 6, 3), readiness: { status: 'unknown', reasons: ['No required trusted gates are configured.'] }, attention: attention('mix-18', [{ kind: 'ready-for-review', severity: 'low', title: 'Changes ready for review', detail: '1 changed file.' }]), queueTier: 2 }),
      buildView({ id: 'mix-19', task: 'Verbose logging cleanup', repositoryId: 'repo-cli', repositoryRoot: 'C:\\projects\\cli-tool', worktreePath: 'C:\\projects\\cli-tool\\worktrees\\log-cleanup', branch: 'chore/log-cleanup', updatedMinutesAgo: 1500, change: changeFiles([]), agent: NO_AGENT, readiness: { status: 'unknown', reasons: ['The branch has no commits ahead of the base reference.'] }, attention: [], queueTier: 3 }),
    ]),
  },
];

export function fixtureByName(name: string): Fixture {
  return fixtures.find((candidate) => candidate.name === name) ?? fixtures[0]!;
}
