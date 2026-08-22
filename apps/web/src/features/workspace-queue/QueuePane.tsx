import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { WorkspaceSnapshot } from '@review-workspace/schema';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { relativeTime } from '../../components/RelativeTime';
import { QueueRow } from './QueueRow';
import { QUEUE_VIEWS, filterViews, groupByRepository, viewContains, type QueueView } from './queueMeta';
import './queue.css';

const VIEW_EMPTY: Record<QueueView, { title: string; copy: string }> = {
  attention: { title: 'Nothing needs attention right now', copy: 'Everything active is ready, idle, or being worked on. Check Ready or All active to see the rest.' },
  progress: { title: 'No agent is working right now', copy: 'When an agent has an open turn in a worktree, its work unit appears here.' },
  ready: { title: 'Nothing is ready to merge yet', copy: 'Work units whose required gates all pass against the current diff appear here.' },
  active: { title: 'No active work units', copy: 'Register an existing Git worktree to start reviewing its changes, gates, and merge readiness.' },
  archived: { title: 'Nothing is archived yet', copy: 'Archive finished or abandoned work units to keep them out of the daily queue. Their files are never touched.' },
};

const VIEW_LABEL: Record<QueueView, string> = {
  attention: 'Needs attention',
  progress: 'In progress',
  ready: 'Ready',
  active: 'All active',
  archived: 'Archived',
};

export function QueuePane({
  snapshot,
  archived,
  view,
  onViewChange,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  onRegister,
  onArchive,
  onUnarchive,
  onArchiveMany,
}: {
  snapshot: WorkspaceSnapshot;
  archived: WorkspaceSnapshot;
  view: QueueView;
  onViewChange: (view: QueueView) => void;
  query: string;
  onQueryChange: (query: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  onRegister: () => void;
  onArchive: (id: string) => Promise<void>;
  onUnarchive: (id: string) => Promise<void>;
  onArchiveMany: (ids: string[]) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const activeView = view !== 'archived';
  const source = activeView ? snapshot.workUnits : archived.workUnits;
  const filtered = useMemo(() => filterViews(source, view, query), [source, view, query]);
  const groups = useMemo(() => groupByRepository(filtered), [filtered]);
  const counts = useMemo(() => {
    const count = (candidate: QueueView) => snapshot.workUnits.filter((unit) => viewContains(unit, candidate)).length;
    return {
      attention: count('attention'),
      progress: count('progress'),
      ready: count('ready'),
      active: snapshot.workUnits.length,
      archived: archived.workUnits.length,
    };
  }, [snapshot, archived]);
  const activeTotal = snapshot.workUnits.length;
  const onboarding = activeView && activeTotal === 0;

  function toggleSelected(id: string, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) next.add(id); else next.delete(id);
    setSelectedIds(next);
  }

  async function bulkArchive() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    await onArchiveMany(ids);
    setSelectedIds(new Set());
  }

  let empty: { title: string; copy: string; action?: ReactNode };
  if (onboarding) {
    empty = {
      title: 'Observe your first worktree',
      copy: 'Start with one work unit: an existing Git worktree on this machine. The workspace reads Git state and runs only gates you approve. It never deletes or modifies the worktree.',
      action: <Button variant="primary" onClick={onRegister}><Icon name="plus" />Observe first worktree</Button>,
    };
  } else if (filtered.length === 0) {
    empty = query.trim()
      ? { title: 'No work units match your search', copy: `Nothing in ${VIEW_LABEL[view]} matches “${query}”.` }
      : VIEW_EMPTY[view];
  } else {
    empty = { title: '', copy: '' };
  }
  const showEmpty = filtered.length === 0;

  return (
    <aside className="queue-pane">
      <header className="queue-heading">
        <div className="queue-title-row">
          <div>
            <p className="eyebrow">Review queue</p>
            <h2>{activeTotal} active unit{activeTotal === 1 ? '' : 's'}</h2>
          </div>
          <span className="queue-updated" title="Last update">{snapshot.seq ? relativeTime(snapshot.generatedAt) : 'Loading'}</span>
        </div>
        <div className="queue-search">
          <Icon name="search" />
          <input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search task, branch, repo" aria-label="Search work units" />
        </div>
      </header>
      <nav className="queue-views" aria-label="Queue views">
        {QUEUE_VIEWS.map((candidate) => (
          <button key={candidate.id} type="button" className={view === candidate.id ? 'active' : ''} aria-pressed={view === candidate.id} onClick={() => onViewChange(candidate.id)}>
            <span>{candidate.label}</span>
            <span className="view-count">{counts[candidate.id]}</span>
          </button>
        ))}
      </nav>
      <div className="queue-list">
        {groups.map((group) => (
          <section className="repo-group" key={group.repositoryId}>
            <header className="repo-head" title={group.root}>
              <span className="repo-name">{group.name}</span>
              <span className="repo-count">{group.views.length}</span>
            </header>
            {group.views.map((candidate) => (
              <QueueRow
                key={candidate.workUnit.id}
                view={candidate}
                selected={selectedId === candidate.workUnit.id}
                onSelect={() => onSelect(candidate.workUnit.id)}
                onArchive={() => void onArchive(candidate.workUnit.id)}
                onUnarchive={() => void onUnarchive(candidate.workUnit.id)}
                bulk={activeView ? { enabled: true, checked: selectedIds.has(candidate.workUnit.id), onToggle: (checked) => toggleSelected(candidate.workUnit.id, checked) } : undefined}
              />
            ))}
          </section>
        ))}
        {showEmpty && <EmptyState title={empty.title} copy={empty.copy} action={empty.action} />}
      </div>
      {activeView && selectedIds.size > 0 && (
        <footer className="queue-bulk-bar">
          <span className="bulk-count">{selectedIds.size} selected</span>
          <Button size="small" variant="secondary" onClick={() => setSelectedIds(new Set())}>Clear</Button>
          <Button size="small" variant="primary" onClick={() => void bulkArchive()}>Archive selected</Button>
        </footer>
      )}
    </aside>
  );
}
