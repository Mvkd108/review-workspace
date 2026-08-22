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
  /**
   * Per changed file path, a hash of the content its patch is based on. The
   * host compares this against the stored reviewed marker to reset a file's
   * review when its underlying patch changes. Not part of the public schema.
   */
  fileHashes?: ReadonlyMap<string, string>;
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
