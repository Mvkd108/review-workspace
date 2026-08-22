import { useState, type FormEvent } from 'react';
import type { AgentLabel, WorkUnitRegistration } from '@review-workspace/schema';
import { useApi } from '../../components/ApiContext';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FieldError } from '../../components/ErrorBanner';
import './registration.css';

export function RegistrationForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const api = useApi();
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
    <Dialog onClose={onClose} labelledBy="register-title">
      <p className="eyebrow">Unmanaged work unit</p>
      <h2 id="register-title">Observe a worktree</h2>
      <p className="dialog-copy">The workspace reads Git state and runs only gates you approve. It never deletes, checks out over, or modifies the worktree — archive and unregister never touch the files.</p>
      <form onSubmit={submit} className="stack-form">
        <label>Task <input name="task" required placeholder="Add retry handling to the API client" autoFocus /></label>
        <label>Worktree path <input name="worktreePath" required placeholder="C:\projects\app-retry" /><small>An existing Git worktree on this machine. The workspace observes it read-only.</small></label>
        <div className="field-row">
          <label>Tool
            <select value={agentLabel} onChange={(event) => setAgentLabel(event.target.value as AgentLabel | '')}>
              <option value="">Unspecified</option><option value="claude-code">Claude Code</option><option value="cursor">Cursor</option><option value="codex">Codex</option><option value="other">Other</option>
            </select>
          </label>
          <label>Base ref <input name="baseRef" placeholder="Auto-detect" /></label>
        </div>
        <label>Confirmed scope globs <input name="allowedGlobs" placeholder="src/api/**, tests/api/**" /><small>Optional. Comma-separated; changes outside these paths are highlighted.</small></label>
        {error && <FieldError>{error}</FieldError>}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Inspecting…' : 'Observe worktree'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
