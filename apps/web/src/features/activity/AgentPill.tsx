import type { AgentActivity, AgentActivityState } from '@review-workspace/schema';
import { relativeTime } from '../../components/RelativeTime';
import './activity.css';

export const ACTIVITY_COPY: Record<AgentActivityState, string> = {
  working: 'Agent working',
  stalled: 'Stopped mid-turn',
  idle: 'Agent idle',
  unknown: 'No agent signal',
};

/**
 * Reported by the agent's own transcript, so it is absent for tools that do not
 * write one. Activity is advisory: it says nothing about whether the change is
 * correct, and it never affects merge readiness. `unknown` means the workspace
 * could not determine the agent's state, which is a distinct condition from
 * `idle`, where a completed turn was actually observed.
 */
export function AgentPill({ activity }: { activity: AgentActivity }) {
  const agents = [...new Set(activity.sessions.map((session) => session.agentLabel))].join(', ');
  const seen = activity.lastActivityAt ? ` · last wrote ${relativeTime(activity.lastActivityAt)}` : '';
  const title = activity.state === 'unknown'
    ? 'No agent transcript could be read for this worktree. Activity is advisory and never affects merge readiness.'
    : activity.state === 'idle'
      ? `The agent's last turn ended${seen}. This does not mean the work is done or correct — only Git and your review say that.`
      : `${agents}${seen}`;
  return (
    <span className={`agent-pill agent-${activity.state}`} title={title}>
      <span className="agent-dot" />
      {ACTIVITY_COPY[activity.state]}
    </span>
  );
}
