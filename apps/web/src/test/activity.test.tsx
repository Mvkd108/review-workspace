import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildView, fixtureByName } from '../fixtures/workspaces';
import { AgentPanel } from '../features/activity/AgentPanel';
import { AgentPill, ACTIVITY_COPY } from '../features/activity/AgentPill';

function panelFor(name: string) {
  const view = fixtureByName(name).snapshot.workUnits[0]!;
  return render(<AgentPanel view={view} />);
}

describe('agent state labels', () => {
  it('distinguishes all four states by distinct copy', () => {
    expect(ACTIVITY_COPY.working).toBe('Agent working');
    expect(ACTIVITY_COPY.stalled).toBe('Stopped mid-turn');
    expect(ACTIVITY_COPY.idle).toBe('Agent idle');
    expect(ACTIVITY_COPY.unknown).toBe('No agent signal');
  });

  it('renders a working session as an open turn', () => {
    panelFor('Agent working');
    expect(screen.getAllByText('Agent working').length).toBeGreaterThan(0);
    expect(screen.getByText('turn open')).toBeInTheDocument();
  });

  it('renders a stalled session as an open turn that stopped', () => {
    panelFor('Agent stalled');
    expect(screen.getAllByText('Stopped mid-turn').length).toBeGreaterThan(0);
    expect(screen.getByText('turn open')).toBeInTheDocument();
  });

  it('describes an idle session as a turn that ended, not a finished task', () => {
    panelFor('One healthy work unit');
    expect(screen.getAllByText('Agent idle').length).toBeGreaterThan(0);
    expect(screen.getByText('turn ended')).toBeInTheDocument();
    expect(screen.queryByText('turn complete')).not.toBeInTheDocument();
  });

  it('reports no signal instead of idle when no transcript binds', () => {
    panelFor('Agent no signal');
    expect(screen.getAllByText('No agent signal').length).toBeGreaterThan(0);
    expect(screen.queryByText('Agent idle')).not.toBeInTheDocument();
    expect(screen.getByText(/none was found, or a format changed/)).toBeInTheDocument();
  });
});

describe('agent activity is advisory', () => {
  it('explains that activity never affects merge readiness', () => {
    panelFor('Agent working');
    expect(screen.getByText(/Advisory only: a transcript reports what the agent says it did/)).toBeInTheDocument();
    expect(screen.getByText(/never affects merge readiness/)).toBeInTheDocument();
  });

  it('keeps Cursor explicitly unsupported rather than guessing', () => {
    panelFor('Agent no signal');
    expect(screen.getByText(/Cursor is not observed/)).toBeInTheDocument();
  });
});

describe('agent privacy', () => {
  it('never renders transcript paths or session payload', () => {
    const { container } = panelFor('Agent working');
    expect(screen.queryByText(/\.claude|\.codex|\.jsonl/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\.claude|\.codex|\.jsonl|sourcePath/);
  });

  it('renders a bounded session id instead of a full path', () => {
    const view = buildView({ agent: fixtureByName('Agent stalled').snapshot.workUnits[0]!.agentActivity });
    const { container } = render(<AgentPanel view={view} />);
    expect(container.textContent).toContain('abc123de');
  });
});
