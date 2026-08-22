import type { WorkUnitView } from '@review-workspace/schema';

export type QueueView = 'attention' | 'progress' | 'ready' | 'active' | 'archived';

export const QUEUE_VIEWS: readonly { id: QueueView; label: string }[] = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'progress', label: 'In progress' },
  { id: 'ready', label: 'Ready' },
  { id: 'active', label: 'All active' },
  { id: 'archived', label: 'Archived' },
];

/** Attention kinds that demand the operator; informational items are excluded. */
const ATTENTION_KINDS = new Set<WorkUnitView['attention'][number]['kind']>([
  'merge-conflict', 'gate-failed', 'gate-stale', 'scope', 'risk', 'unavailable', 'agent-stalled',
]);

export function isArchived(view: WorkUnitView): boolean {
  return view.workUnit.visibility === 'archived';
}

export function viewContains(view: WorkUnitView, queueView: QueueView): boolean {
  if (queueView === 'archived') return isArchived(view);
  if (isArchived(view)) return false;
  switch (queueView) {
    case 'attention': return view.attention.some((item) => ATTENTION_KINDS.has(item.kind));
    case 'progress': return view.agentActivity.state === 'working';
    case 'ready': return view.mergeReadiness.status === 'ready';
    case 'active': return true;
  }
}

function normalize(value: string): string {
  return value.toLocaleLowerCase();
}

export function matchesQuery(view: WorkUnitView, query: string): boolean {
  const needle = normalize(query.trim());
  if (!needle) return true;
  const unit = view.workUnit;
  const haystack = [
    unit.task,
    unit.branch,
    unit.baseRef,
    unit.repositoryRoot,
    unit.worktreePath,
    unit.agentDisplayName ?? '',
    unit.agentLabel ?? '',
    ...(view.change?.files.map((file) => file.path) ?? []),
  ].join(' ').toLocaleLowerCase();
  return haystack.includes(needle);
}

export function filterViews(views: readonly WorkUnitView[], queueView: QueueView, query: string): WorkUnitView[] {
  return views.filter((view) => viewContains(view, queueView) && matchesQuery(view, query));
}

export interface RepositoryGroup {
  repositoryId: string;
  name: string;
  root: string;
  views: WorkUnitView[];
}

function repositoryName(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? root;
}

export function groupByRepository(views: readonly WorkUnitView[]): RepositoryGroup[] {
  const byRepository = new Map<string, RepositoryGroup>();
  for (const view of views) {
    const unit = view.workUnit;
    const group = byRepository.get(unit.repositoryId) ?? {
      repositoryId: unit.repositoryId,
      name: repositoryName(unit.repositoryRoot),
      root: unit.repositoryRoot,
      views: [],
    };
    group.views.push(view);
    byRepository.set(unit.repositoryId, group);
  }
  return [...byRepository.values()];
}

export interface RowMeta {
  state: string;
  tone: 'danger' | 'warn' | 'ok' | 'info' | 'muted';
  action: string;
}

/**
 * One primary state and one recommended next action per row. Activity never
 * feeds merge readiness, but for the row display the actionable signals are
 * ordered: an unavailable or blocked unit needs the operator before a ready or
 * clean one does.
 */
export function rowMeta(view: WorkUnitView): RowMeta {
  if (isArchived(view)) return { state: 'Archived', tone: 'muted', action: 'No longer observed' };
  const unit = view.workUnit;
  if (unit.lifecycle === 'unavailable' || !view.change) {
    return { state: 'Unavailable', tone: 'danger', action: 'Restore the worktree path' };
  }
  if (view.risk.reasons.some((reason) => reason.code.startsWith('gate.failed'))) {
    return { state: 'Blocked', tone: 'danger', action: 'Fix the failing gate and re-run it' };
  }
  if (view.mergeReadiness.status === 'blocked') {
    return { state: 'Blocked', tone: 'danger', action: 'Resolve what is blocking the merge' };
  }
  if (view.agentActivity.state === 'working') {
    return { state: 'In progress', tone: 'info', action: 'Wait for the agent to finish' };
  }
  if (view.agentActivity.state === 'stalled') {
    return { state: 'Stalled', tone: 'warn', action: 'Check whether the agent is still running' };
  }
  if (view.mergeReadiness.status === 'ready') {
    return { state: 'Ready', tone: 'ok', action: 'Ready to merge' };
  }
  if (view.risk.reasons.some((reason) => reason.code.startsWith('gate.stale'))) {
    return { state: 'Needs checks', tone: 'warn', action: 'Re-run the required gate' };
  }
  if ((view.change.files.length) > 0) {
    return { state: 'Needs review', tone: 'warn', action: 'Review the changes' };
  }
  return { state: 'Clean', tone: 'muted', action: 'No action needed' };
}
