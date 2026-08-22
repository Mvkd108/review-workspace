import { useState, type FormEvent } from 'react';
import type { GateDefinitionInput, WorkUnitView } from '@review-workspace/schema';
import { useApi } from '../../components/ApiContext';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FieldError } from '../../components/ErrorBanner';
import { formatTimeout, repositoryName } from './gateStatus';
import './gates.css';

export function GateForm({
  view,
  onDone,
  onClose,
  initial,
}: {
  view: WorkUnitView;
  onDone: () => Promise<void>;
  onClose: () => void;
  initial?: GateDefinitionInput;
}) {
  const api = useApi();
  const [error, setError] = useState('');
  const [name, setName] = useState(initial?.name ?? '');
  const [program, setProgram] = useState(initial?.program ?? '');
  const [args, setArgs] = useState((initial?.args ?? []).join('\n'));
  const [cwd, setCwd] = useState(initial?.cwd ?? '');
  const [timeoutMs, setTimeoutMs] = useState(String(initial?.timeoutMs ?? 600000));
  const [required, setRequired] = useState(initial?.required ?? true);

  const previewArgs = args.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const willRun = [program.trim(), ...previewArgs].filter(Boolean).join(' ') || '—';
  const previewCwd = cwd.trim() || '.';
  const previewTimeout = formatTimeout(Math.max(Number(timeoutMs) || 0, 0));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const definition: GateDefinitionInput = {
      name: name.trim(),
      program: program.trim(),
      args: previewArgs,
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
      required,
      timeoutMs: Math.min(Math.max(Number(timeoutMs) || 600000, 1000), 3_600_000),
    };
    if (!definition.name || !definition.program) { setError('A name and an executable are required.'); return; }
    try { await api.addGate(view.workUnit.id, definition); await onDone(); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  return (
    <Dialog onClose={onClose} labelledBy="gate-form-title">
      <p className="eyebrow">Trusted check · {repositoryName(view.workUnit.repositoryRoot)}</p>
      <h2 id="gate-form-title">Add a trusted check</h2>
      <p className="dialog-copy">The check is stored outside the worktree and shared by every work unit in this repository. It will not run until you explicitly run it.</p>
      <form className="stack-form" onSubmit={submit}>
        <div className="field-row">
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Unit tests" autoFocus /></label>
          <label>Executable<input value={program} onChange={(event) => setProgram(event.target.value)} required placeholder={navigator.platform.startsWith('Win') ? 'pnpm.cmd' : 'pnpm'} /></label>
        </div>
        <label>Arguments <small>One argument per line</small><textarea value={args} onChange={(event) => setArgs(event.target.value)} rows={3} placeholder={'test\n--runInBand'} /></label>
        <div className="field-row">
          <label>Working directory<input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="." /></label>
          <label>Timeout (ms)<input value={timeoutMs} onChange={(event) => setTimeoutMs(event.target.value)} type="number" min="1000" /></label>
        </div>
        <label className="check-label"><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} />Required for merge readiness</label>
        <div className="gate-preview">
          <span className="gate-preview-title">What will be approved</span>
          <dl className="gate-preview-list">
            <div><dt>Command</dt><dd><code>{willRun}</code></dd></div>
            <div><dt>Directory</dt><dd>{previewCwd}</dd></div>
            <div><dt>Timeout</dt><dd>{previewTimeout}</dd></div>
            <div><dt>Requirement</dt><dd>{required ? 'Blocks merge readiness' : 'Advisory'}</dd></div>
          </dl>
        </div>
        {error && <FieldError>{error}</FieldError>}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit">Approve trusted check</Button>
        </div>
      </form>
    </Dialog>
  );
}
