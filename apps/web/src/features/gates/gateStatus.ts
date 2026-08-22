import type { GateDefinition, GateRun, WorkUnitView } from '@review-workspace/schema';

/**
 * The five states the contract defines for a check result. `error` is a subcase
 * of `failed` and is normalized to it for display.
 */
export type GateState = 'missing' | 'running' | 'passed' | 'failed' | 'stale';

export interface GateStatusInfo {
  state: GateState;
  run?: GateRun;
}

/** The latest run for a gate, normalized to the contract's five states. */
export function gateStatus(view: WorkUnitView, gateId: string): GateStatusInfo {
  const run = view.gateRuns.find((candidate) => candidate.gateId === gateId);
  if (!run) return { state: 'missing' };
  const state: GateState = run.status === 'error' ? 'failed' : run.status;
  return { state, run };
}

export const GATE_STATE_COPY: Record<GateState, string> = {
  missing: 'Missing',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  stale: 'Stale',
};

export function requiredGates(view: WorkUnitView): GateDefinition[] {
  return view.gateDefinitions.filter((gate) => gate.required);
}

export function repositoryName(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? root;
}

export function formatTimeout(ms: number): string {
  if (ms >= 60_000) {
    const minutes = ms / 60_000;
    return Number.isInteger(minutes) ? `${minutes} min` : `${Math.round(minutes * 10) / 10} min`;
  }
  return `${ms} ms`;
}

export function formatDuration(ms?: number): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${Math.round((ms / 1000) * 10) / 10} s`;
}

function gateName(view: WorkUnitView, reasonCode: string, fallbackLabel: string): string {
  const gateId = reasonCode.slice(reasonCode.lastIndexOf('.') + 1);
  return view.gateDefinitions.find((gate) => gate.id === gateId)?.name ?? fallbackLabel;
}

/**
 * The single most useful next step when merge readiness is blocked. Returns ''
 * when the unit is not blocked. Derives from the concrete reasons, never from
 * internal sort scores.
 */
export function readinessNextAction(view: WorkUnitView): string {
  if (view.mergeReadiness.status !== 'blocked') return '';
  const reasons = view.mergeReadiness.reasons;
  const failed = view.risk.reasons.find((reason) => reason.code.startsWith('gate.failed'));
  if (failed) return `Fix and re-run the failing check: ${gateName(view, failed.code, failed.label)}.`;
  const stale = view.risk.reasons.find((reason) => reason.code.startsWith('gate.stale'));
  if (stale) return `Run the required check: ${gateName(view, stale.code, stale.label)}.`;
  if (view.risk.reasons.some((reason) => reason.code === 'git.conflict')) {
    return 'Resolve the merge conflict against the configured base ref.';
  }
  if (reasons.some((reason) => reason.includes('uncommitted'))) return 'Commit or stash the uncommitted changes first.';
  if (reasons.some((reason) => reason.includes('No required trusted gates'))) return 'Add a required trusted check for this repository.';
  if (reasons.some((reason) => reason.includes('no commits ahead'))) return 'This branch has no changes to merge yet.';
  return reasons[0] ?? 'Resolve what is blocking the merge.';
}
