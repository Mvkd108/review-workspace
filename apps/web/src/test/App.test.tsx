import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkspaceSnapshot } from '@review-workspace/schema';
import { App } from '../App';
import { fixtures, fixtureByName, snapshot, buildView, type Fixture } from '../fixtures/workspaces';
import { stubApi } from '../harness/StubApi';
import type { ApiLike } from '../api';

function renderFixture(fixture: Fixture, api?: ApiLike) {
  return render(<App api={api ?? stubApi(fixture)} />);
}

describe('App render', () => {
  it('renders the shell and onboarding empty states for an empty workspace', async () => {
    renderFixture(fixtureByName('Empty workspace'));
    expect(await screen.findByText('Review Workspace')).toBeInTheDocument();
    expect(screen.getByText('0 active units')).toBeInTheDocument();
    expect(screen.getByText('Observe your first worktree')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Observe first worktree' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Review work, not chat logs.' })).toBeInTheDocument();
  });

  it('renders a healthy work unit and its detail', async () => {
    const user = userEvent.setup();
    renderFixture(fixtureByName('One healthy work unit'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Add retry handling to the API client' })).toBeInTheDocument();
    expect((await screen.findAllByText('Merge ready')).length).toBeGreaterThan(0);
    expect(screen.getByText('1 active unit')).toBeInTheDocument();
    expect(screen.getByText('Nothing needs attention right now')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Checks' }));
    expect(await screen.findByText('Unit tests')).toBeInTheDocument();
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });

  it('renders a blocked work unit with its risk reasons and queue row', async () => {
    renderFixture(fixtureByName('Blocked work unit'));
    expect(await screen.findByText('Conflicts with the base branch')).toBeInTheDocument();
    expect((await screen.findAllByText('Blocked')).length).toBeGreaterThan(0);
    expect(screen.getByText('Resolve what is blocking the merge')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('renders a working agent from its transcript', async () => {
    renderFixture(fixtureByName('Agent working'));
    expect((await screen.findAllByText('Agent working')).length).toBeGreaterThan(0);
    expect(screen.getByText('turn open')).toBeInTheDocument();
  });

  it('renders a stalled agent raised in the queue', async () => {
    renderFixture(fixtureByName('Agent stalled'));
    expect((await screen.findAllByText('Stopped mid-turn')).length).toBeGreaterThan(0);
    expect(screen.getByText('Stalled')).toBeInTheDocument();
    expect(screen.getByText('turn open')).toBeInTheDocument();
  });

  it('renders every check-state fixture', async () => {
    const checkFixtures = fixtures.filter((fixture) => ['Missing checks', 'Failed checks', 'Passed checks', 'Stale checks'].includes(fixture.name));
    expect(checkFixtures).toHaveLength(4);
    for (const fixture of checkFixtures) {
      const view = fixture.snapshot.workUnits[0]!;
      expect(view.gateDefinitions.length).toBeGreaterThan(0);
      const user = userEvent.setup();
      const { unmount } = renderFixture(fixture);
      await user.click(await screen.findByRole('button', { name: 'Checks' }));
      expect(await screen.findByText('Unit tests')).toBeInTheDocument();
      unmount();
    }
  });
});

describe('App error and loading', () => {
  it('shows a global error when the workspace fetch fails', async () => {
    render(<App api={stubApi(fixtures[0]!, { failWorkspace: true })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Simulated workspace failure.');
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('keeps the queue navigable while the first snapshot is loading', () => {
    const pending = () => new Promise<WorkspaceSnapshot>(() => {});
    const api: ApiLike = { ...stubApi(fixtures[0]!), workspace: pending };
    render(<App api={api} />);
    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search work units' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Needs attention/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Review work, not chat logs.' })).toBeInTheDocument();
  });
});

describe('App selection', () => {
  it('selects a work unit from the queue and shows its detail', async () => {
    const user = userEvent.setup();
    const twoUnits = snapshot([
      buildView({ id: 'unit-a', task: 'First task' }),
      buildView({ id: 'unit-b', task: 'Second task' }),
    ]);
    renderFixture({ name: 'Two units', description: '', snapshot: twoUnits });
    await user.click(screen.getByRole('button', { name: /All active/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'First task' })).toBeInTheDocument();
    await user.click(screen.getByText('Second task'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Second task' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'First task' })).not.toBeInTheDocument();
  });
});

describe('Queue views and search', () => {
  it('filters the queue by view and groups by repository', async () => {
    const user = userEvent.setup();
    renderFixture(fixtureByName('19 work units across repositories'));
    expect((await screen.findAllByText('Resolve what is blocking the merge')).length).toBeGreaterThan(0);
    expect(screen.getByText('api-gateway')).toBeInTheDocument();
    expect(screen.queryByText('Rate limiting middleware')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /All active/ }));
    expect(await screen.findByText('Rate limiting middleware')).toBeInTheDocument();
    expect(screen.getByText('admin-console')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Archived/ }));
    expect(await screen.findByText('Retired emoji flag spike')).toBeInTheDocument();
  });

  it('searches the queue with keyboard input', async () => {
    const user = userEvent.setup();
    renderFixture(fixtureByName('19 work units across repositories'));
    await user.click(screen.getByRole('button', { name: /All active/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Search work units' }), 'rate limit');
    expect(await screen.findByText('Rate limiting middleware')).toBeInTheDocument();
    expect(screen.queryByText('Bulk user import flow')).not.toBeInTheDocument();
  });

  it('shows per-view counts instead of one undifferentiated total', async () => {
    renderFixture(fixtureByName('19 work units across repositories'));
    expect(await screen.findByText('16 active units')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Needs attention/ })).toHaveTextContent('6');
    expect(screen.getByRole('button', { name: /All active/ })).toHaveTextContent('16');
    expect(screen.getByRole('button', { name: /Archived/ })).toHaveTextContent('3');
  });
});

describe('Archive controls', () => {
  it('archives a work unit through the API and never unregisters it', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const base = stubApi(fixtureByName('19 work units across repositories'));
    const spied: ApiLike = {
      ...base,
      archive: async (id) => { calls.push('archive'); return base.archive(id); },
      unregister: async (id) => { calls.push('unregister'); return base.unregister(id); },
    };
    render(<App api={spied} />);
    await user.click(screen.getByRole('button', { name: /All active/ }));
    const archiveButton = await screen.findByRole('button', { name: 'Archive Conflicting route refactor' });
    await user.click(archiveButton);
    expect(calls).toEqual(['archive']);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Archive Conflicting route refactor' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Archived/ }));
    expect(await screen.findByRole('button', { name: 'Restore Conflicting route refactor' })).toBeInTheDocument();
  });

  it('restores an archived work unit', async () => {
    const user = userEvent.setup();
    renderFixture(fixtureByName('19 work units across repositories'));
    await user.click(screen.getByRole('button', { name: /Archived/ }));
    const restore = await screen.findByRole('button', { name: 'Restore Retired emoji flag spike' });
    await user.click(restore);
    await user.click(screen.getByRole('button', { name: /All active/ }));
    expect(await screen.findByText('Retired emoji flag spike')).toBeInTheDocument();
  });

  it('bulk-archives selected units', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const base = stubApi(fixtureByName('19 work units across repositories'));
    const spied: ApiLike = {
      ...base,
      archiveMany: async (ids) => { calls.push(...ids); return base.archiveMany(ids); },
    };
    render(<App api={spied} />);
    await user.click(screen.getByRole('button', { name: /All active/ }));
    await user.click(await screen.findByRole('checkbox', { name: 'Select Conflicting route refactor' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Rate limiting middleware' }));
    await user.click(screen.getByRole('button', { name: 'Archive selected' }));
    expect(calls).toEqual(['mix-01', 'mix-03']);
  });
});

describe('App interactions', () => {
  it('switches to the per-file diff tab and to the unified diff secondary view', async () => {
    const user = userEvent.setup();
    renderFixture(fixtureByName('500 changed files'));
    await user.click(await screen.findByRole('button', { name: 'Diff' }));
    expect(await screen.findByText('diff --git a/dist/gen/schema-000.d.ts b/dist/gen/schema-000.d.ts')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unified diff' }));
    expect(await screen.findByText('diff --git a/dist/gen/schema-000.d.ts b/dist/gen/schema-000.d.ts')).toBeInTheDocument();
  });

  it('opens the registration dialog from the onboarding empty state', async () => {
    const user = userEvent.setup();
    renderFixture(fixtureByName('Empty workspace'));
    await user.click(screen.getByRole('button', { name: 'Observe first worktree' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Observe a worktree' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
