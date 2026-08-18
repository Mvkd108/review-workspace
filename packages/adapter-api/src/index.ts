import type {
  ChangeSummary,
  GateDefinition,
  GateRun,
  WorkUnit,
  WorkspaceEvent,
} from '@review-workspace/schema';

export interface RepositoryInspection {
  repositoryId: string;
  repositoryRoot: string;
  branch: string;
  change: ChangeSummary;
  unifiedDiff: string;
  mergeConflict: boolean | null;
}

export interface RepositoryAdapter {
  inspect(workUnit: WorkUnit, reviewedFiles: ReadonlySet<string>): Promise<RepositoryInspection>;
}

export interface GateProvider {
  run(workUnit: WorkUnit, gate: GateDefinition, fingerprint: string): Promise<GateRun>;
}

export interface AgentAdapter {
  readonly id: string;
  start(workUnit: WorkUnit): Promise<void>;
  stop(workUnitId: string): Promise<void>;
}

export interface WorkspaceEmitter {
  publish(event: WorkspaceEvent): void;
}
