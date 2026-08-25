import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { App } from '../App';
import { buildView, fixtureByName, fixtures, snapshot } from '../fixtures/workspaces';
import { stubApi } from '../harness/StubApi';

// jsdom cannot compute colors, layout metrics, or scrolling, so the rules that
// depend on them are disabled; everything else is judged.
const AXE_OPTIONS: axe.RunOptions = {
  rules: {
    'color-contrast': { enabled: false },
    'scrollable-region-focusable': { enabled: false },
    'target-size': { enabled: false },
  },
};

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, AXE_OPTIONS);
  return results.violations;
}

function renderFixture(name: string) {
  return render(<App api={stubApi(fixtureByName(name))} />);
}

describe('accessibility', () => {
  it('has no serious or critical axe violations on the healthy workspace', async () => {
    document.title = 'Review Workspace';
    renderFixture('One healthy work unit');
    await screen.findByRole('heading', { level: 1 });
    const result = await violations(document.body);
    const blockers = result.filter((item) => item.impact === 'critical' || item.impact === 'serious');
    expect(blockers.map((item) => item.id)).toEqual([]);
  });

  it('has no serious or critical axe violations on the busy workspace', async () => {
    document.title = 'Review Workspace';
    renderFixture('19 work units across repositories');
    await screen.findByRole('heading', { level: 1 });
    const result = await violations(document.body);
    const blockers = result.filter((item) => item.impact === 'critical' || item.impact === 'serious');
    expect(blockers.map((item) => item.id)).toEqual([]);
  });

  it('has no serious or critical axe violations with the registration dialog open', async () => {
    document.title = 'Review Workspace';
    const user = userEvent.setup();
    renderFixture('Empty workspace');
    await user.click(await screen.findByRole('button', { name: 'Observe first worktree' }));
    await screen.findByRole('dialog');
    const result = await violations(document.body);
    const blockers = result.filter((item) => item.impact === 'critical' || item.impact === 'serious');
    expect(blockers.map((item) => item.id)).toEqual([]);
  });

  it('labels every interactive control semantically', () => {
    renderFixture('19 work units across repositories');
    expect(screen.getByRole('searchbox', { name: 'Search work units' })).toBeInTheDocument();
    for (const label of ['Needs attention', 'In progress', 'Ready', 'All active', 'Archived']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toHaveAttribute('aria-pressed');
    }
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});

describe('keyboard flow', () => {
  it('reaches the search box, filters, and activates a queue row with Enter', async () => {
    const user = userEvent.setup();
    renderFixture('19 work units across repositories');
    const search = screen.getByRole('searchbox', { name: 'Search work units' });
    search.focus();
    await user.keyboard('rate limit');
    await user.click(screen.getByRole('button', { name: /All active/ }));
    const row = (await screen.findAllByRole('button', { name: /Rate limiting middleware/ }))[0]!;
    row.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Rate limiting middleware' })).toBeInTheDocument();
  });

  it('switches queue views with the keyboard', async () => {
    const user = userEvent.setup();
    renderFixture('19 work units across repositories');
    const archived = screen.getByRole('button', { name: /^Archived/ });
    archived.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Retired emoji flag spike')).toBeInTheDocument();
  });

  it('switches detail tabs with the keyboard', async () => {
    const user = userEvent.setup();
    renderFixture('500 changed files');
    const diffTab = await screen.findByRole('button', { name: 'Diff' });
    diffTab.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/diff --git a\/dist\/gen\/schema-000\.d\.ts/)).toBeInTheDocument();
  });

  it('moves focus into the registration dialog and returns it on Escape', async () => {
    const user = userEvent.setup();
    renderFixture('Empty workspace');
    const trigger = screen.getByRole('button', { name: 'Observe first worktree' });
    trigger.focus();
    await user.click(trigger);
    await screen.findByRole('dialog');
    expect(document.activeElement).toBe(screen.getByLabelText(/Task/));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it('traps tab focus inside the dialog', async () => {
    const user = userEvent.setup();
    renderFixture('Empty workspace');
    await user.click(screen.getByRole('button', { name: 'Observe first worktree' }));
    const dialog = await screen.findByRole('dialog');
    const withinDialog = within(dialog);
    const task = withinDialog.getByLabelText(/Task/);
    task.focus();
    await user.tab();
    expect(document.activeElement).toBe(withinDialog.getByLabelText(/Worktree path/));
    // Forward past the last control wraps to the first focusable (the close button).
    const submit = withinDialog.getByRole('button', { name: 'Observe worktree' });
    submit.focus();
    await user.tab();
    expect(document.activeElement).toBe(withinDialog.getByRole('button', { name: 'Close' }));
    // And backward from the first wraps to the last.
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(submit);
  });

  it('toggles bulk-archive selection with the spacebar', async () => {
    const user = userEvent.setup();
    renderFixture('19 work units across repositories');
    await user.click(screen.getByRole('button', { name: /All active/ }));
    const checkbox = await screen.findByRole('checkbox', { name: 'Select Conflicting route refactor' });
    checkbox.focus();
    await user.keyboard(' ');
    expect(checkbox).toBeChecked();
    expect(await screen.findByText('1 selected')).toBeInTheDocument();
  });

  it('keeps every fixture free of name collisions for assistive labels', () => {
    for (const fixture of fixtures) {
      const view = fixture.snapshot.workUnits[0];
      if (!view) continue;
      const { unmount } = render(<App api={stubApi(fixture)} />);
      unmount();
    }
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
  });
});

describe('semantic structure', () => {
  it('builds a view with correct heading hierarchy and landmark structure', () => {
    const twoUnits = snapshot([
      buildView({ id: 'unit-a', task: 'First task' }),
      buildView({ id: 'unit-b', task: 'Second task' }),
    ]);
    const { container } = render(<App api={stubApi({ name: 'two', description: '', snapshot: twoUnits })} />);
    // testing-library treats every <header> as a banner even when nested in
    // sectioning content; axe (the arbiter) counts only the top bar, so the
    // landmark assertions below use the semantic markup directly.
    expect(container.querySelector('header.topbar')).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});

