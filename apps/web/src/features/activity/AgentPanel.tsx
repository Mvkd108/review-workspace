import type { WorkUnitView } from '@review-workspace/schema';
import { relativeTime } from '../../components/RelativeTime';
import { Icon } from '../../components/Icon';
import { AgentPill } from './AgentPill';

/**
 * Advisory evidence panel. Transcripts report what an agent says it did; only
 * Git says what changed, so activity here never affects merge readiness. The
 * raw transcript path and any message content or tool output never appear.
 */
export function AgentPanel({ view }: { view: WorkUnitView }) {
  const sessions = view.agentActivity.sessions;
  return (
    <section className="panel agent-panel">
      <div className="panel-title"><span><Icon name="agent" />Agent activity</span><AgentPill activity={view.agentActivity} /></div>
      {sessions.length === 0
        ? <div className="soft-empty compact">No agent signal. No Codex or Claude Code transcript could be read for this worktree — none was found, or a format changed and the workspace chose not to guess.</div>
        : <ul className="session-list">{sessions.map((session) => (
          <li key={`${session.agentLabel}:${session.sessionId}:${session.cwd}`}>
            <span className={`agent-dot agent-${session.state}`} />
            <strong>{session.agentLabel}</strong>
            <span className="session-state">{session.lastTurnComplete ? 'turn ended' : 'turn open'}</span>
            <span className="muted-copy">wrote {relativeTime(session.lastActivityAt)}</span>
            <code>{session.sessionId.slice(0, 8)}</code>
          </li>
        ))}</ul>}
      <p className="agent-advice">Advisory only: a transcript reports what the agent says it did, and it never affects merge readiness — only Git says what changed. Cursor is not observed; it does not write transcript files.</p>
    </section>
  );
}
