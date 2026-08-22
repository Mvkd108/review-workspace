import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GateProposal, GateRun, WorkUnitView } from '@review-workspace/schema';
import type { ApiLike } from '../api';
import { ApiContext } from '../components/ApiContext';
import { App } from '../App';
import { buildView, fixtureByName, gate, run, snapshot } from '../fixtures/workspaces';
import { stubApi } from '../harness/StubApi';
import { GatesPanel } from '../features/gates/GatesPanel';
import { ReviewSummary } from '../features/review/ReviewSummary';

function fakeRun(gateId: string): GateRun {
  return { id: `run-${gateId}`, gateId, workUnitId: 'unit', status: 'passed', definitionHash: 'def', worktreeFingerprint: 'fp', startedAt: new Date().toISOString(), output: '' };
}

function renderPanel(view: WorkUnitView, overrides: Partial<ApiLike> = {}, onRefresh: () => Promise<void> = async () => {}) {
  const base = stubApi({ name: 'test', description: '', snapshot: snapshot([view]) });
  const api: ApiLike = {
    ...base,
    addGate: async () => ({}),
    runGate: async (_id, gateId) => fakeRun(gateId),
    removeGate: async () => undefined,
    ...overrides,
  };
  return render(
    <ApiContext.Provider value={api}>
      <GatesPanel view={view} onRefresh={onRefresh} />
    </ApiContext.Provider>,
  );
}

const NO_GATES = {
  gates: [],
  proposals: [],
  readiness: { status: 'blocked' as const, reasons: ['No required trusted gates are configured.'] },
};

describe('guided trusted-check setup', () => {
  it('guides a first-time user when the repository has no trusted checks', async () => {
    renderPanel(buildView({ id: 'a', ...NO_GATES }));
    expect(screen.getByText('Set up trusted checks for repo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up first trusted check' })).toBeInTheDocument();
    expect(screen.getByText(/shared across repo/i)).toBeInTheDocument();
  });

  it('shows the exact executable, arguments, directory, timeout, and required status before approval', async () => {
    const user = userEvent.setup();
    renderPanel(buildView({ id: 'a', ...NO_GATES }));
    await user.click(screen.getByRole('button', { name: 'Set up first trusted check' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Name/), 'Unit tests');
    await user.type(screen.getByLabelText(/Executable/), 'pnpm.cmd');
    await user.type(screen.getByLabelText(/Arguments/), 'test\n--runInBand');
    await user.type(screen.getByLabelText(/Working directory/), 'src/api');
    expect(screen.getByText('pnpm.cmd test --runInBand')).toBeInTheDocument();
    expect(screen.getByText('src/api')).toBeInTheDocument();
    expect(screen.getByText('10 min')).toBeInTheDocument();
    expect(screen.getByText('Blocks merge readiness')).toBeInTheDocument();
  });
});

describe('repository proposals stay inert', () => {
  it('promotes a proposal without running it until approval', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const pending: GateProposal = {
      name: 'Unit tests', program: 'pnpm.cmd', args: ['test'], cwd: '.', timeoutMs: 600000, required: true,
      proposalHash: 'hash-1', sourcePath: '.review-workspace-gates.json',
    };
    const view = buildView({ id: 'a', gates: [], proposals: [pending], readiness: { status: 'blocked', reasons: ['No required trusted gates are configured.'] } });
    renderPanel(view, {
      addGate: async () => { calls.push('addGate'); return {}; },
      runGate: async () => { calls.push('runGate'); return fakeRun('tests'); },
    });
    expect(screen.getByText(/inert until you approve/i)).toBeInTheDocument();
    expect(screen.getByText('pnpm.cmd test')).toBeInTheDocument();
    expect(screen.getByText('10 min')).toBeInTheDocument();
    expect(calls).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(calls).toEqual(['addGate']);
  });

  it('does not auto-execute a branch-supplied proposal when it renders', async () => {
    const calls: string[] = [];
    const pending: GateProposal = {
      name: 'Lint', program: 'pnpm.cmd', args: ['lint'], proposalHash: 'hash-2', sourcePath: '.review-workspace-gates.json', timeoutMs: 120000, required: true,
    };
    renderPanel(buildView({ id: 'a', gates: [], proposals: [pending], readiness: { status: 'blocked', reasons: ['No required trusted gates are configured.'] } }), {
      runGate: async () => { calls.push('runGate'); return fakeRun('lint'); },
    });
    expect(calls).toEqual([]);
  });
});

describe('run required checks', () => {
  it('runs every required check once, in order', async () => {
    const user = userEvent.setup();
    const ran: string[] = [];
    const view = buildView({
      id: 'a',
      gates: [gate('tests', 'Unit tests'), gate('lint', 'Lint', ['lint'])],
      runs: [],
      readiness: { status: 'blocked', reasons: ['Unit tests has no current result for this diff.', 'Lint has no current result for this diff.'] },
    });
    renderPanel(view, {
      runGate: async (_id, gateId) => { ran.push(gateId); return fakeRun(gateId); },
    });
    await user.click(screen.getByRole('button', { name: 'Run required checks' }));
    expect(ran).toEqual(['tests', 'lint']);
  });

  it('does not offer to run required checks when there are none approved', async () => {
    renderPanel(buildView({ id: 'a', ...NO_GATES }));
    expect(screen.getByRole('button', { name: 'Run required checks' })).toBeDisabled();
  });
});

describe('check state rendering', () => {
  it('renders missing, running, passed, failed, and stale as distinct states', async () => {
    const view = buildView({
      id: 'states',
      gates: [gate('m', 'Missing gate'), gate('r', 'Running gate'), gate('p', 'Passed gate'), gate('f', 'Failed gate'), gate('s', 'Stale gate')],
      runs: [run('r', 'running'), run('p', 'passed'), run('f', 'failed'), run('s', 'stale', 'old-fingerprint')],
    });
    renderPanel(view);
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('presents captured output in a controlled panel with exit code and duration', async () => {
    const user = userEvent.setup();
    const view = buildView({
      id: 'out',
      gates: [gate('p', 'Passed gate')],
      runs: [run('p', 'passed', undefined, 'All 42 tests passed.\nDone.')],
    });
    renderPanel(view);
    const toggle = screen.getByRole('button', { name: /View output/ });
    await user.click(toggle);
    expect(screen.getByText(/All 42 tests passed/)).toBeInTheDocument();
    expect(screen.getByText(/Exit 0/)).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.queryByText(/All 42 tests passed/)).not.toBeInTheDocument();
  });
});

describe('readiness next action', () => {
  it('shows the next required action when readiness is blocked', async () => {
    const view = fixtureByName('Missing checks').snapshot.workUnits[0]!;
    render(<ReviewSummary view={view} />);
    expect(screen.getByText('Next: Run the required check: Unit tests.')).toBeInTheDocument();
  });

  it('points at the failing check when a gate failed', async () => {
    const view = fixtureByName('Failed checks').snapshot.workUnits[0]!;
    render(<ReviewSummary view={view} />);
    expect(screen.getByText('Next: Fix and re-run the failing check: Unit tests.')).toBeInTheDocument();
  });
});

describe('merge readiness is evidence-backed', () => {
  it('never shows Merge ready while Git or a required check blocks it', async () => {
    for (const name of ['Missing checks', 'Failed checks', 'Stale checks', 'Running checks', 'Blocked work unit']) {
      const { unmount } = render(<App api={stubApi(fixtureByName(name))} />);
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByText('Merge ready')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('shows Merge ready for a healthy unit', async () => {
    render(<App api={stubApi(fixtureByName('One healthy work unit'))} />);
    expect((await screen.findAllByText('Merge ready')).length).toBeGreaterThan(0);
  });

  it('never renders internal numeric risk scores', async () => {
    render(<App api={stubApi(fixtureByName('Blocked work unit'))} />);
    await screen.findByText('Conflicts with the base branch');
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.queryByText('85')).not.toBeInTheDocument();
  });
});
