import { useEffect, useState } from 'react';
import type { WorkUnitView } from '@review-workspace/schema';
import { useApi } from '../../components/ApiContext';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { StatusPill } from '../../components/Pill';
import { Tabs, type Tab } from '../../components/Tabs';
import { isArchived } from '../workspace-queue/queueMeta';
import { AgentPanel } from '../activity/AgentPanel';
import { AgentPill } from '../activity/AgentPill';
import { GatesPanel } from '../gates/GatesPanel';
import { FilesPanel } from './FilesPanel';
import { PerFileDiff } from './PerFileDiff';
import { ReviewSummary } from './ReviewSummary';
import './review.css';

const TABS: readonly Tab[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'files', label: 'Files' },
  { id: 'diff', label: 'Diff' },
  { id: 'checks', label: 'Checks' },
  { id: 'activity', label: 'Activity' },
];

type TabId = 'summary' | 'files' | 'diff' | 'checks' | 'activity';

export function Detail({
  view,
  onRefresh,
  onUnregister,
  onArchive,
  onUnarchive,
}: {
  view: WorkUnitView;
  onRefresh: () => Promise<void>;
  onUnregister: () => Promise<void>;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  const api = useApi();
  const [tab, setTab] = useState<TabId>('summary');
  const [diffPath, setDiffPath] = useState('');
  useEffect(() => {
    setTab('summary');
    setDiffPath('');
  }, [view.workUnit.id]);
  async function unregister() {
    if (window.confirm('Unregister removes this work unit from the workspace. Its worktree and files are not changed or deleted. Continue?')) await onUnregister();
  }
  const archived = isArchived(view);
  const filePaths = (view.change?.files ?? []).map((file) => file.path);
  const openFile = (filePath: string) => {
    setDiffPath(filePath);
    setTab('diff');
  };
  return <main className="detail-pane">
    <header className="detail-header">
      <div>
        <p className="eyebrow">{view.workUnit.agentDisplayName || view.workUnit.agentLabel || 'Unmanaged worktree'}</p>
        <h1>{view.workUnit.task}</h1>
        <div className="detail-sub">
          <span><Icon name="branch" />{view.workUnit.branch}</span>
          <span>against {view.workUnit.baseRef}</span>
          <span>{view.workUnit.worktreePath}</span>
        </div>
      </div>
      <div className="detail-status">
        <AgentPill activity={view.agentActivity} />
        <StatusPill status={view.mergeReadiness.status} />
        <div className="detail-actions">
          {archived
            ? <Button variant="secondary" size="small" onClick={onUnarchive}>Restore</Button>
            : <Button variant="secondary" size="small" onClick={onArchive}>Archive</Button>}
          <button className="kebab" onClick={unregister}>Unregister</button>
        </div>
      </div>
    </header>
    {archived ? (
      <div className="detail-tab-content">
        <div className="detail-content">
          <ReviewSummary view={view} />
          <section className="panel archived-panel">
            <div className="panel-title"><span><Icon name="archive" />Archived work unit</span></div>
            <p className="archived-copy">This work unit is archived and no longer observed. Restore it to resume reviewing. Its worktree and files were never changed or deleted.</p>
          </section>
        </div>
      </div>
    ) : (
      <>
        <Tabs tabs={TABS} active={tab} onChange={(id) => setTab(id as TabId)} />
        <div className="detail-tab-content">
          {tab === 'summary' && <div className="detail-content">
            <ReviewSummary view={view} />
            <AgentPanel view={view} />
          </div>}
          {tab === 'files' && <div className="detail-content"><FilesPanel view={view} onRefresh={onRefresh} onOpenFile={openFile} /></div>}
          {tab === 'diff' && <PerFileDiff view={view} paths={filePaths} selectedPath={filePaths.includes(diffPath) ? diffPath : (filePaths[0] ?? '')} onSelectPath={setDiffPath} />}
          {tab === 'checks' && <div className="detail-content"><GatesPanel view={view} onRefresh={onRefresh} /></div>}
          {tab === 'activity' && <div className="detail-content"><AgentPanel view={view} /></div>}
        </div>
      </>
    )}
  </main>;
}
