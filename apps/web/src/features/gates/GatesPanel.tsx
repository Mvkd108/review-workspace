import { useState } from 'react';
import type { GateProposal, WorkUnitView } from '@review-workspace/schema';
import { useApi } from '../../components/ApiContext';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { relativeTime } from '../../components/RelativeTime';
import { GateForm } from './GateForm';
import { GateStatusPill } from './GateStatusPill';
import { formatDuration, formatTimeout, gateStatus, repositoryName, requiredGates } from './gateStatus';
import './gates.css';

export function GatesPanel({ view, onRefresh }: { view: WorkUnitView; onRefresh: () => Promise<void> }) {
  const api = useApi();
  const [runningIds, setRunningIds] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<{ total: number; current: number } | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const repo = repositoryName(view.workUnit.repositoryRoot);
  const required = requiredGates(view);
  const setupNeeded = view.gateDefinitions.length === 0 && view.gateProposals.length === 0;

  function addRunning(id: string) { setRunningIds((previous) => new Set(previous).add(id)); }
  function removeRunning(id: string) {
    setRunningIds((previous) => { const next = new Set(previous); next.delete(id); return next; });
  }

  async function runSingle(gateId: string) {
    if (runningIds.has(gateId)) return;
    addRunning(gateId);
    try { await api.runGate(view.workUnit.id, gateId); await onRefresh(); }
    finally { removeRunning(gateId); }
  }

  async function runRequiredChecks() {
    const gates = required;
    if (gates.length === 0) return;
    for (let index = 0; index < gates.length; index++) {
      const gate = gates[index]!;
      setPending({ total: gates.length, current: index + 1 });
      addRunning(gate.id);
      try { await api.runGate(view.workUnit.id, gate.id); await onRefresh(); }
      finally { removeRunning(gate.id); }
    }
    setPending(null);
  }

  async function approveProposal(proposal: GateProposal) {
    await api.addGate(view.workUnit.id, proposal);
    await onRefresh();
  }

  async function removeGate(gateId: string, name: string) {
    if (window.confirm(`Remove the trusted check “${name}”? Existing worktree files are not affected.`)) {
      await api.removeGate(view.workUnit.id, gateId); await onRefresh();
    }
  }

  return <section className="panel gates-panel">
    <div className="panel-title"><span><Icon name="gate" />Trusted checks</span><span className="muted-copy">Stored outside the worktree · shared across {repo}</span></div>

    {setupNeeded && (
      <div className="setup-callout">
        <div className="setup-copy">
          <strong>Set up trusted checks for {repo}</strong>
          <p>A check runs outside the worktree and is reused by every work unit in this repository. A required check must pass against the current diff before anything can be merge ready.</p>
          <ol className="setup-steps">
            <li>Name the check, for example “Unit tests”.</li>
            <li>Choose an executable and its arguments.</li>
            <li>Set the working directory and timeout.</li>
            <li>Approve it — it will not run until you run it.</li>
          </ol>
        </div>
        <Button variant="primary" onClick={() => setShowForm(true)}><Icon name="plus" />Set up first trusted check</Button>
      </div>
    )}

    {view.gateProposals.length > 0 && (
      <div className="proposal-callout">
        <div className="proposal-callout-title">
          <Icon name="warning" />
          <div><strong>{view.gateProposals.length} proposed check{view.gateProposals.length === 1 ? '' : 's'}</strong><span>Proposed by .review-workspace-gates.json · inert until you approve them</span></div>
        </div>
        {view.gateProposals.map((proposal) => (
          <div className="proposal-row" key={proposal.proposalHash}>
            <div className="proposal-detail">
              <strong>{proposal.name}</strong>
              <dl className="gate-preview-list">
                <div><dt>Command</dt><dd><code>{[proposal.program, ...(proposal.args ?? [])].join(' ')}</code></dd></div>
                <div><dt>Directory</dt><dd>{proposal.cwd?.trim() || '.'}</dd></div>
                <div><dt>Timeout</dt><dd>{formatTimeout(proposal.timeoutMs ?? 600000)}</dd></div>
                <div><dt>Requirement</dt><dd>{proposal.required === false ? 'Advisory' : 'Blocks merge readiness'}</dd></div>
              </dl>
            </div>
            <Button variant="primary" size="small" onClick={() => void approveProposal(proposal)}>Approve</Button>
          </div>
        ))}
        <p className="proposal-inert">Approving stores the check outside the worktree. Nothing runs until you press Run.</p>
      </div>
    )}

    {view.gateDefinitions.length > 0 && (
      <div className="checks-table">
        <div className="checks-head"><span>Check</span><span>Status and actions</span></div>
        {view.gateDefinitions.map((gate) => {
          const status = gateStatus(view, gate.id);
          const isRunning = runningIds.has(gate.id);
          const displayState = isRunning ? 'running' as const : status.state;
          const run = status.run;
          const drawerOpen = run ? openRun === run.id : false;
          return <div className="gate-row" key={gate.id}>
            <div className="gate-info">
              <strong>{gate.name}</strong>
              <code>{gate.program} {gate.args.join(' ')}</code>
              <span className="gate-meta">in {gate.cwd?.trim() || '.'} · {formatTimeout(gate.timeoutMs)} · {gate.required ? 'required' : 'advisory'}</span>
            </div>
            <div className="gate-result">
              <GateStatusPill state={displayState} />
              <div className="gate-actions">
                <Button size="small" variant="secondary" disabled={isRunning} onClick={() => void runSingle(gate.id)}>
                  {isRunning ? 'Running…' : run ? 'Run again' : 'Run'}
                </Button>
                {run?.output !== undefined && run.output !== '' && (
                  <button type="button" className="text-button output-toggle" aria-expanded={drawerOpen} onClick={() => setOpenRun(drawerOpen ? null : run!.id)}>
                    View output · {formatDuration(run.durationMs)}
                  </button>
                )}
                <button type="button" className="remove-gate" onClick={() => void removeGate(gate.id, gate.name)} aria-label={`Remove ${gate.name}`}>Remove</button>
              </div>
            </div>
            {drawerOpen && run && (
              <div className="gate-output">
                <div className="gate-output-meta">Exit {run.exitCode ?? '—'} · duration {formatDuration(run.durationMs)} · finished {run.finishedAt ? relativeTime(run.finishedAt) : '—'}</div>
                <pre>{run.output || 'No output captured.'}</pre>
              </div>
            )}
          </div>;
        })}
      </div>
    )}

    <div className="gates-footer">
      <Button variant="secondary" size="small" disabled={required.length === 0 || pending !== null} onClick={() => void runRequiredChecks()}>
        <Icon name="play" />
        {pending ? `Running required checks… ${pending.current} of ${pending.total}` : 'Run required checks'}
      </Button>
      {view.gateDefinitions.length > 0 && (
        <button type="button" className="text-button" onClick={() => setShowForm(true)}><Icon name="plus" />Add trusted check</button>
      )}
    </div>

    {showForm && <GateForm view={view} onDone={onRefresh} onClose={() => setShowForm(false)} />}
  </section>;
}
