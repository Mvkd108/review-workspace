export const WORKSPACE_SCHEMA_VERSION = '0.2.0' as const;

export type WorkUnitKind = 'unmanaged' | 'managed';
export type AgentLabel = 'claude-code' | 'cursor' | 'codex' | 'other';
export type WorkUnitLifecycle = 'observing' | 'ready-for-review' | 'blocked' | 'unavailable';
export type RiskLevel = 'low' | 'medium' | 'high';
export type MergeReadinessStatus = 'ready' | 'blocked' | 'unknown';
export type GateRunStatus = 'running' | 'passed' | 'failed' | 'error' | 'stale';
export type AgentActivityState = 'working' | 'idle' | 'stalled' | 'unknown';

export interface TaskScope {
  allowedGlobs: string[];
  inferredPathTokens: string[];
  confirmed: boolean;
}

export interface WorkUnit {
  id: string;
  kind: WorkUnitKind;
  task: string;
  agentLabel?: AgentLabel;
  agentDisplayName?: string;
  repositoryId: string;
  repositoryRoot: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  lifecycle: WorkUnitLifecycle;
  scope: TaskScope;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single agent session observed through the agent's own transcript file.
 * The workspace reads these records; it never launches or controls the agent.
 */
export interface AgentSession {
  sessionId: string;
  agentLabel: AgentLabel;
  /** Working directory the session reported for itself. */
  cwd: string;
  /** Transcript the state was derived from. */
  sourcePath: string;
  state: AgentActivityState;
  lastActivityAt: string;
  /** False when the most recent turn has no completion record in the transcript. */
  lastTurnComplete: boolean;
}

export interface AgentActivity {
  state: AgentActivityState;
  lastActivityAt?: string;
  /** Sessions bound to this worktree, most recently active first. */
  sessions: AgentSession[];
}

export type ChangeFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked';

export interface ChangeFile {
  path: string;
  previousPath?: string;
  status: ChangeFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  reviewed: boolean;
}

export interface ChangeSummary {
  baseCommit?: string;
  headCommit: string;
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  files: ChangeFile[];
  additions: number;
  deletions: number;
  topLevelAreas: string[];
  trackedDiffHash: string;
  untrackedContentHash: string;
  fingerprint: string;
  lastChangedAt: string;
}

export interface GateDefinition {
  id: string;
  repositoryId: string;
  name: string;
  program: string;
  args: string[];
  cwd?: string;
  envAllowlist: string[];
  timeoutMs: number;
  required: boolean;
  definitionHash: string;
  approvedAt: string;
}

export interface GateRun {
  id: string;
  gateId: string;
  workUnitId: string;
  status: GateRunStatus;
  definitionHash: string;
  worktreeFingerprint: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  durationMs?: number;
  output: string;
}

export interface RiskReason {
  code: string;
  label: string;
  detail: string;
  weight: number;
}

export interface RiskAssessment {
  level: RiskLevel;
  reasons: RiskReason[];
  /** Internal ordering signal. User interfaces must not display this value. */
  sortScore: number;
}

export interface AttentionItem {
  id: string;
  workUnitId: string;
  kind: 'merge-conflict' | 'gate-failed' | 'gate-stale' | 'scope' | 'risk' | 'ready-for-review' | 'unavailable' | 'agent-working' | 'agent-stalled';
  severity: RiskLevel;
  title: string;
  detail: string;
}

export interface MergeReadiness {
  status: MergeReadinessStatus;
  reasons: string[];
}

export interface WorkUnitView {
  workUnit: WorkUnit;
  change: ChangeSummary | null;
  agentActivity: AgentActivity;
  risk: RiskAssessment;
  mergeReadiness: MergeReadiness;
  gateDefinitions: GateDefinition[];
  gateProposals: GateProposal[];
  gateRuns: GateRun[];
  attention: AttentionItem[];
  queueTier: number;
}

export interface WorkspaceSnapshot {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  seq: number;
  generatedAt: string;
  workUnits: WorkUnitView[];
}

export interface WorkUnitRegistration {
  task: string;
  worktreePath: string;
  baseRef?: string;
  kind?: WorkUnitKind;
  agentLabel?: AgentLabel;
  agentDisplayName?: string;
  allowedGlobs?: string[];
}

export interface GateDefinitionInput {
  name: string;
  program: string;
  args?: string[];
  cwd?: string;
  envAllowlist?: string[];
  timeoutMs?: number;
  required?: boolean;
}

export interface GateProposal extends GateDefinitionInput {
  proposalHash: string;
  sourcePath: string;
}

export interface ReviewedFilesInput {
  files: string[];
  reviewed: boolean;
}

export type WorkspaceEvent = {
  type: 'workspace.snapshot';
  seq: number;
  snapshot: WorkspaceSnapshot;
};
