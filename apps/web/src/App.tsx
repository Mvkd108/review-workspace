import { useEffect, useMemo, useState } from 'react';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceSnapshot } from '@review-workspace/schema';
import { api, type ApiLike } from './api';
import { ApiContext } from './components/ApiContext';
import { Button } from './components/Button';
import { Placeholder } from './components/EmptyState';
import { GlobalError } from './components/ErrorBanner';
import { Icon } from './components/Icon';
import { IconButton } from './components/IconButton';
import { Detail } from './features/review/Detail';
import { RegistrationForm } from './features/registration/RegistrationForm';
import { QueuePane } from './features/workspace-queue/QueuePane';
import type { QueueView } from './features/workspace-queue/queueMeta';

const EMPTY: WorkspaceSnapshot = { schemaVersion: WORKSPACE_SCHEMA_VERSION, seq: 0, generatedAt: new Date(0).toISOString(), workUnits: [] };

export function App({ api: client = api }: { api?: ApiLike }) {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [archivedSnapshot, setArchivedSnapshot] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState('');
  const [connected, setConnected] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [view, setView] = useState<QueueView>('attention');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const allViews = useMemo(() => [...snapshot.workUnits, ...archivedSnapshot.workUnits], [snapshot, archivedSnapshot]);
  const selected = useMemo(
    () => allViews.find((candidate) => candidate.workUnit.id === selectedId) ?? snapshot.workUnits[0],
    [allViews, snapshot, selectedId],
  );

  async function refresh() {
    try {
      const next = await client.workspace();
      setSnapshot(next);
      if (!selectedId && next.workUnits[0]) setSelectedId(next.workUnits[0].workUnit.id);
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function refreshArchived() {
    try { setArchivedSnapshot(await client.archived()); } catch { /* the archived view degrades to empty */ }
  }

  useEffect(() => {
    void refresh();
    void refreshArchived();
    return client.events(
      (event) => { setSnapshot(event.snapshot); setSelectedId((current) => current || event.snapshot.workUnits[0]?.workUnit.id || ''); },
      setConnected,
    );
  }, [client]);

  async function archiveById(id: string) {
    await client.archive(id);
    await Promise.all([refresh(), refreshArchived()]);
  }

  async function unarchiveById(id: string) {
    await client.unarchive(id);
    await Promise.all([refresh(), refreshArchived()]);
  }

  async function archiveMany(ids: string[]) {
    await client.archiveMany(ids);
    await Promise.all([refresh(), refreshArchived()]);
  }

  async function unregisterSelected() {
    if (!selected) return;
    await client.unregister(selected.workUnit.id);
    setSelectedId('');
    await Promise.all([refresh(), refreshArchived()]);
  }

  return (
    <ApiContext.Provider value={client}>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand"><span className="brand-mark">R</span><div><strong>Review Workspace</strong><span>Repo channel</span></div></div>
          <div className="topbar-actions">
            <span className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'Live' : 'Reconnecting'}</span>
            <IconButton onClick={() => void refresh()} title="Refresh"><Icon name="refresh" /></IconButton>
            <Button variant="primary" onClick={() => setShowRegister(true)}><Icon name="plus" />Observe worktree</Button>
          </div>
        </header>
        {error && <GlobalError>{error}</GlobalError>}
        <div className="workspace-layout">
          <QueuePane
            snapshot={snapshot}
            archived={archivedSnapshot}
            view={view}
            onViewChange={setView}
            query={query}
            onQueryChange={setQuery}
            selectedId={selected?.workUnit.id ?? ''}
            onSelect={setSelectedId}
            onRegister={() => setShowRegister(true)}
            onArchive={archiveById}
            onUnarchive={unarchiveById}
            onArchiveMany={archiveMany}
          />
          {selected
            ? <Detail view={selected} onRefresh={refresh} onUnregister={unregisterSelected} onArchive={() => void archiveById(selected.workUnit.id)} onUnarchive={() => void unarchiveById(selected.workUnit.id)} />
            : <Placeholder title="Review work, not chat logs." copy="Register a worktree to rank its changes by concrete evidence." />}
        </div>
        {showRegister && <RegistrationForm onClose={() => setShowRegister(false)} onSaved={refresh} />}
      </div>
    </ApiContext.Provider>
  );
}
