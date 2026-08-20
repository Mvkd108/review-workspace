import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AgentActivity, AgentActivityState, AgentLabel, GateDefinitionInput, WorkUnitRegistration, WorkUnitView, WorkspaceSnapshot } from '@review-workspace/schema';
import { api } from './api';

const EMPTY: WorkspaceSnapshot = { schemaVersion: '0.2.0', seq: 0, generatedAt: new Date(0).toISOString(), workUnits: [] };

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function Icon({ name }: { name: 'branch' | 'check' | 'warning' | 'plus' | 'refresh' | 'file' | 'gate' | 'close' | 'agent' }) {
  const paths = {
    branch: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M8 9h5a5 5 0 0 0 5-1"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    warning: <><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4M12 17h.01"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    refresh: <><path d="M20 7h-5V2"/><path d="M20 7a9 9 0 1 0 1 8"/></>,
    file: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/></>,
    gate: <><path d="M4 20V5l8-3 8 3v15"/><path d="M8 20v-8h8v8"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    agent: <><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h.01M15 14h.01"/></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

function StatusPill({ view }: { view: WorkUnitView }) {
  const status = view.mergeReadiness.status;
  return <span className={`pill pill-${status}`}>{status === 'ready' ? 'Merge ready' : status === 'blocked' ? 'Blocked' : 'Needs evidence'}</span>;
}

const ACTIVITY_COPY: Record<AgentActivityState, string> = {
  working: 'Agent working',
  stalled: 'Stopped mid-turn',
  idle: 'Agent idle',
  unknown: 'No agent seen',
};

/**
 * Reported by the agent's own transcript, so it is absent for tools that do not
 * write one. It says nothing about whether the change is correct.
 */
function AgentPill({ activity }: { activity: AgentActivity }) {
  if (activity.state === 'unknown') return null;
  const agents = [...new Set(activity.sessions.map((session) => session.agentLabel))].join(', ');
  const seen = activity.lastActivityAt ? ` · last wrote ${relativeTime(activity.lastActivityAt)}` : '';
  return (
    <span className={`agent-pill agent-${activity.state}`} title={`${agents}${seen}`}>
      <span className="agent-dot" />
      {ACTIVITY_COPY[activity.state]}
    </span>
  );
}

function QueueCard({ view, selected, onClick }: { view: WorkUnitView; selected: boolean; onClick: () => void }) {
  const changed = view.change?.files.length ?? 0;
  return (
    <button className={`queue-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="queue-card-top">
        <span className={`risk-dot risk-${view.risk.level}`} title={`${view.risk.level} risk`} />
        <span className="agent-label">{view.workUnit.agentDisplayName || view.workUnit.agentLabel || 'Unmanaged'}</span>
        <span className="queue-time">{relativeTime(view.workUnit.updatedAt)}</span>
      </div>
      <h3>{view.workUnit.task}</h3>
      <div className="branch-line"><Icon name="branch" /><span>{view.workUnit.branch}</span></div>
      <div className="queue-meta">
        <StatusPill view={view} />
        <AgentPill activity={view.agentActivity} />
        <span>{changed} file{changed === 1 ? '' : 's'}</span>
        {view.gateDefinitions.length > 0 && <span>{view.gateDefinitions.length} gate{view.gateDefinitions.length === 1 ? '' : 's'}</span>}
      </div>
    </button>
  );
}

function RegistrationForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [agentLabel, setAgentLabel] = useState<AgentLabel | ''>('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    const input: WorkUnitRegistration = {
      task: String(data.get('task') ?? ''),
      worktreePath: String(data.get('worktreePath') ?? ''),
      ...(String(data.get('baseRef') ?? '').trim() ? { baseRef: String(data.get('baseRef')).trim() } : {}),
      ...(agentLabel ? { agentLabel } : {}),
      allowedGlobs: String(data.get('allowedGlobs') ?? '').split(',').map((item) => item.trim()).filter(Boolean),
    };
    try { await api.register(input); await onSaved(); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return (
    <div className="scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="register-title">
        <button className="icon-button dialog-close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        <p className="eyebrow">Unmanaged work unit</p>
        <h2 id="register-title">Observe a worktree</h2>
        <p className="dialog-copy">The workspace reads Git state and runs only gates you approve. It never deletes or modifies the worktree.</p>
        <form onSubmit={submit} className="stack-form">
          <label>Task <input name="task" required placeholder="Add retry handling to the API client" autoFocus /></label>
          <label>Worktree path <input name="worktreePath" required placeholder="C:\projects\app-retry" /></label>
          <div className="field-row">
            <label>Tool
              <select value={agentLabel} onChange={(event) => setAgentLabel(event.target.value as AgentLabel | '')}>
                <option value="">Unspecified</option><option value="claude-code">Claude Code</option><option value="cursor">Cursor</option><option value="codex">Codex</option><option value="other">Other</option>
              </select>
            </label>
            <label>Base ref <input name="baseRef" placeholder="Auto-detect" /></label>
          </div>
          <label>Confirmed scope globs <input name="allowedGlobs" placeholder="src/api/**, tests/api/**" /><small>Optional. Comma-separated; changes outside these paths are highlighted.</small></label>
          {error && <div className="form-error">{error}</div>}
          <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Inspecting…' : 'Observe worktree'}</button></div>
        </form>
      </section>
    </div>
  );
}

function GateForm({ view, onDone }: { view: WorkUnitView; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const data = new FormData(event.currentTarget);
    const definition: GateDefinitionInput = {
      name: String(data.get('name') ?? ''), program: String(data.get('program') ?? ''),
      args: String(data.get('args') ?? '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      ...(String(data.get('cwd') ?? '').trim() ? { cwd: String(data.get('cwd')).trim() } : {}),
      required: data.get('required') === 'on', timeoutMs: Number(data.get('timeoutMs') ?? 600000),
    };
    try { await api.addGate(view.workUnit.id, definition); setOpen(false); await onDone(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  if (!open) return <button className="text-button" onClick={() => setOpen(true)}><Icon name="plus" />Add trusted gate</button>;
  return <form className="inline-gate-form" onSubmit={submit}>
    <div className="field-row"><label>Name<input name="name" required placeholder="Unit tests" /></label><label>Executable<input name="program" required placeholder="pnpm.cmd" /></label></div>
    <label>Arguments <small>One argument per line</small><textarea name="args" rows={3} placeholder={'test\n--runInBand'} /></label>
    <div className="field-row"><label>Working directory<input name="cwd" placeholder="." /></label><label>Timeout (ms)<input name="timeoutMs" type="number" defaultValue="600000" min="1000" /></label></div>
    <label className="check-label"><input name="required" type="checkbox" defaultChecked />Required for merge readiness</label>
    {error && <div className="form-error">{error}</div>}
    <div className="inline-actions"><button type="button" className="text-button muted" onClick={() => setOpen(false)}>Cancel</button><button className="button primary small">Approve definition</button></div>
  </form>;
}

function DiffView({ diff }: { diff: string }) {
  if (!diff) return <div className="soft-empty"><Icon name="check" /><p>No diff to review.</p></div>;
  return <pre className="diff-view">{diff.split('\n').map((line, index) => <div key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'diff-add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-remove' : line.startsWith('@@') ? 'diff-hunk' : line.startsWith('diff --git') ? 'diff-file' : ''}><span className="line-number">{index + 1}</span>{line || ' '}</div>)}</pre>;
}

function Detail({ view, onRefresh, onUnregister }: { view: WorkUnitView; onRefresh: () => Promise<void>; onUnregister: () => Promise<void> }) {
  const [tab, setTab] = useState<'overview' | 'diff'>('overview');
  const [diff, setDiff] = useState('');
  const [runningGate, setRunningGate] = useState('');
  useEffect(() => { setTab('overview'); setDiff(''); }, [view.workUnit.id]);
  useEffect(() => { if (tab === 'diff' && !diff) void api.diff(view.workUnit.id).then(setDiff); }, [tab, diff, view.workUnit.id]);
  const runByGate = new Map(view.gateRuns.map((run) => [run.gateId, run]));
  async function runGate(gateId: string) { setRunningGate(gateId); try { await api.runGate(view.workUnit.id, gateId); await onRefresh(); } finally { setRunningGate(''); } }
  async function removeGate(gateId: string, name: string) { if (window.confirm(`Remove the trusted gate “${name}”? Existing worktree files are not affected.`)) { await api.removeGate(view.workUnit.id, gateId); await onRefresh(); } }
  async function approveProposal(index: number) { const proposal = view.gateProposals[index]; if (!proposal) return; await api.addGate(view.workUnit.id, proposal); await onRefresh(); }
  async function unregister() { if (window.confirm('Unregister this work unit? Its worktree and files will not be changed.')) await onUnregister(); }
  return <main className="detail-pane">
    <header className="detail-header">
      <div><p className="eyebrow">{view.workUnit.agentDisplayName || view.workUnit.agentLabel || 'Unmanaged worktree'}</p><h1>{view.workUnit.task}</h1><div className="detail-sub"><span><Icon name="branch" />{view.workUnit.branch}</span><span>against {view.workUnit.baseRef}</span><span>{view.workUnit.worktreePath}</span></div></div>
      <div className="detail-status"><AgentPill activity={view.agentActivity} /><StatusPill view={view} /><button className="kebab" onClick={unregister}>Unregister</button></div>
    </header>
    <nav className="tabs"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Review</button><button className={tab === 'diff' ? 'active' : ''} onClick={() => setTab('diff')}>Unified diff</button></nav>
    {tab === 'diff' ? <DiffView diff={diff} /> : <div className="detail-content">
      <section className="summary-grid">
        <article className="panel attention-panel"><div className="panel-title"><span><Icon name="warning" />Why it needs attention</span><span className={`risk-label risk-${view.risk.level}`}>{view.risk.level}</span></div>
          {view.risk.reasons.length ? <ul className="reason-list">{view.risk.reasons.map((item) => <li key={item.code}><strong>{item.label}</strong><span>{item.detail}</span></li>)}</ul> : <div className="positive"><Icon name="check" /><span>No elevated risk reasons detected.</span></div>}
        </article>
        <article className="panel readiness-panel"><div className="panel-title"><span><Icon name={view.mergeReadiness.status === 'ready' ? 'check' : 'branch'} />Merge readiness</span><StatusPill view={view} /></div><ul className="plain-list">{view.mergeReadiness.reasons.map((item) => <li key={item}>{item}</li>)}</ul></article>
      </section>
      <section className="panel agent-panel"><div className="panel-title"><span><Icon name="agent" />Agent activity</span><AgentPill activity={view.agentActivity} /></div>
        {view.agentActivity.sessions.length === 0
          ? <div className="soft-empty compact">No agent transcript reports this worktree. Codex and Claude Code are observed; Cursor does not write one.</div>
          : <ul className="session-list">{view.agentActivity.sessions.map((session) => <li key={session.sourcePath}>
              <span className={`agent-dot agent-${session.state}`} />
              <strong>{session.agentLabel}</strong>
              <span className="session-state">{session.lastTurnComplete ? 'turn complete' : 'turn open'}</span>
              <span className="muted-copy">wrote {relativeTime(session.lastActivityAt)}</span>
              <code title={session.sourcePath}>{session.sessionId.slice(0, 8)}</code>
            </li>)}</ul>}
      </section>
      <section className="panel changes-panel"><div className="panel-title"><span><Icon name="file" />Changed files</span><span className="muted-copy">{view.change?.additions ?? 0} additions · {view.change?.deletions ?? 0} deletions</span></div>
        {!view.change?.files.length ? <div className="soft-empty compact">No changes against the base reference.</div> : <div className="file-list">{view.change.files.map((file) => <label className="file-row" key={file.path}><input type="checkbox" checked={file.reviewed} onChange={(event) => void api.setReviewed(view.workUnit.id, [file.path], event.target.checked).then(onRefresh)} /><span className={`file-status status-${file.status}`}>{file.status[0]?.toUpperCase()}</span><span className="file-path">{file.path}</span>{file.previousPath && <span className="previous-path">from {file.previousPath}</span>}<span className="diff-stat"><b>+{file.additions}</b><i>-{file.deletions}</i></span></label>)}</div>}
      </section>
      <section className="panel gates-panel"><div className="panel-title"><span><Icon name="gate" />Trusted gates</span><span className="muted-copy">Stored outside the worktree</span></div>
        {view.gateProposals.map((proposal, index) => <div className="proposal-row" key={proposal.proposalHash}><div><strong>{proposal.name}</strong><code>{proposal.program} {(proposal.args ?? []).join(' ')}</code><span>Proposed by {proposal.sourcePath} · {proposal.proposalHash.slice(0, 8)}</span></div><button className="button secondary small" onClick={() => void approveProposal(index)}>Approve proposal</button></div>)}
        {view.gateDefinitions.map((gate) => { const run = runByGate.get(gate.id); return <div className="gate-row" key={gate.id}><div><strong>{gate.name}</strong><code>{gate.program} {gate.args.join(' ')}</code></div><div className="gate-result">{run && <span className={`gate-status gate-${run.status}`}>{run.status}</span>}<button className="button secondary small" disabled={runningGate === gate.id} onClick={() => void runGate(gate.id)}>{runningGate === gate.id ? 'Running…' : run ? 'Run again' : 'Run gate'}</button><button className="remove-gate" onClick={() => void removeGate(gate.id, gate.name)} aria-label={`Remove ${gate.name}`}>Remove</button></div>{run?.output && <details><summary>View output · {run.durationMs ?? 0} ms</summary><pre>{run.output}</pre></details>}</div>; })}
        <GateForm view={view} onDone={onRefresh} />
      </section>
    </div>}
  </main>;
}

export function App() {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState('');
  const [connected, setConnected] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [error, setError] = useState('');
  const selected = useMemo(() => snapshot.workUnits.find((view) => view.workUnit.id === selectedId) ?? snapshot.workUnits[0], [snapshot, selectedId]);
  async function refresh() { try { const next = await api.workspace(); setSnapshot(next); if (!selectedId && next.workUnits[0]) setSelectedId(next.workUnits[0].workUnit.id); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }
  useEffect(() => { void refresh(); return api.events((event) => { setSnapshot(event.snapshot); setSelectedId((current) => current || event.snapshot.workUnits[0]?.workUnit.id || ''); }, setConnected); }, []);
  async function unregisterSelected() { if (!selected) return; await api.unregister(selected.workUnit.id); setSelectedId(''); await refresh(); }
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">R</span><div><strong>Review Workspace</strong><span>Repo channel</span></div></div><div className="topbar-actions"><span className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'Live' : 'Reconnecting'}</span><button className="icon-button" onClick={() => void refresh()} title="Refresh"><Icon name="refresh" /></button><button className="button primary" onClick={() => setShowRegister(true)}><Icon name="plus" />Observe worktree</button></div></header>
    {error && <div className="global-error">{error}</div>}
    <div className="workspace-layout">
      <aside className="queue-pane"><div className="queue-heading"><div><p className="eyebrow">Attention queue</p><h2>{snapshot.workUnits.length} work unit{snapshot.workUnits.length === 1 ? '' : 's'}</h2></div><span title="Last update">{snapshot.seq ? relativeTime(snapshot.generatedAt) : 'Loading'}</span></div>
        <div className="queue-list">{snapshot.workUnits.map((view) => <QueueCard key={view.workUnit.id} view={view} selected={selected?.workUnit.id === view.workUnit.id} onClick={() => setSelectedId(view.workUnit.id)} />)}</div>
        {snapshot.workUnits.length === 0 && <div className="queue-empty"><div className="empty-symbol"><Icon name="branch" /></div><h3>Your review queue is clear</h3><p>Observe an existing Git worktree to see its changes, gates, and merge readiness.</p><button className="button primary" onClick={() => setShowRegister(true)}><Icon name="plus" />Observe first worktree</button></div>}
      </aside>
      {selected ? <Detail view={selected} onRefresh={refresh} onUnregister={unregisterSelected} /> : <main className="detail-placeholder"><div className="empty-symbol large"><Icon name="check" /></div><h1>Review work, not chat logs.</h1><p>Register a worktree to rank its changes by concrete evidence.</p></main>}
    </div>
    {showRegister && <RegistrationForm onClose={() => setShowRegister(false)} onSaved={refresh} />}
  </div>;
}
