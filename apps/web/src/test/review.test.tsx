import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChangeSummary } from '@review-workspace/schema';
import { App } from '../App';
import { buildView, fixtureByName, snapshot } from '../fixtures/workspaces';
import { stubApi } from '../harness/StubApi';

function changeWith(files: { path: string; status?: ChangeSummary['files'][number]['status']; reviewed?: boolean }[]): ChangeSummary {
  return {
    baseCommit: 'base', headCommit: 'head', branch: 'feature', dirty: false, ahead: 1, behind: 0,
    additions: files.length, deletions: 0, files: files.map((file) => ({
      path: file.path,
      status: file.status ?? 'modified',
      additions: 1, deletions: 0, binary: false, reviewed: file.reviewed ?? false,
    })),
    topLevelAreas: [...new Set(files.map((file) => file.path.split('/')[0] ?? file.path))],
    trackedDiffHash: 't', untrackedContentHash: 'u', fingerprint: 'fp', lastChangedAt: new Date().toISOString(),
  };
}

function renderView(files: { path: string; status?: ChangeSummary['files'][number]['status']; reviewed?: boolean }[], task = 'Review task') {
  const view = buildView({ id: 'unit-rv', task, change: changeWith(files) });
  return render(<App api={stubApi({ name: 'review', description: '', snapshot: snapshot([view]) })} />);
}

describe('Review files tab', () => {
  it('paginates a 500-file change so the page stays bounded', async () => {
    const user = userEvent.setup();
    render(<App api={stubApi(fixtureByName('500 changed files'))} />);
    await user.click(await screen.findByRole('button', { name: 'Files' }));

    expect(screen.getByText('dist/gen/schema-000.d.ts')).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 5/)).toBeInTheDocument();
    expect(screen.getByText(/500 of 500 files/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('dist/gen/schema-100.d.ts')).toBeInTheDocument();
    expect(screen.getByText(/Page 2 of 5/)).toBeInTheDocument();
    expect(screen.queryByText('dist/gen/schema-000.d.ts')).not.toBeInTheDocument();
  });

  it('filters by reviewed status, directory, and risk surface', async () => {
    const user = userEvent.setup();
    const view = buildView({
      id: 'unit-rv', task: 'Review task',
      risk: { level: 'medium', sortScore: 30, reasons: [{ code: 'change.sensitive', label: 'Sensitive surface', detail: 'Touches sensitive project surfaces: src/auth/session.ts', weight: 20 }] },
      change: changeWith([
        { path: 'src/client.ts', status: 'modified' },
        { path: 'src/auth/session.ts', status: 'modified', reviewed: true },
        { path: 'tests/client.test.ts', status: 'added' },
      ]),
    });
    render(<App api={stubApi({ name: 'review', description: '', snapshot: snapshot([view]) })} />);

    await user.click(await screen.findByRole('button', { name: 'Files' }));
    expect(screen.getByText(/3 of 3 files/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Reviewed status'), 'reviewed');
    expect(await screen.findByText(/1 of 3 files/)).toBeInTheDocument();
    expect(screen.getByText('src/auth/session.ts')).toBeInTheDocument();
    expect(screen.queryByText('src/client.ts')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Reviewed status'), 'unreviewed');
    await user.selectOptions(screen.getByLabelText('Directory'), 'tests');
    expect(await screen.findByText(/1 of 3 files/)).toBeInTheDocument();
    expect(screen.getByText('tests/client.test.ts')).toBeInTheDocument();

    // A risk reason naming src/auth/session.ts flags it as a risk surface.
    await user.selectOptions(screen.getByLabelText('Reviewed status'), 'all');
    await user.selectOptions(screen.getByLabelText('Directory'), 'all');
    await user.click(screen.getByRole('checkbox', { name: 'Risk surface only' }));
    expect(await screen.findByText(/1 of 3 files/)).toBeInTheDocument();
    expect(screen.getByText('src/auth/session.ts')).toBeInTheDocument();
  });

  it('renders a file as unreviewed after the host resets the marker', async () => {
    const user = userEvent.setup();
    const reviewed = renderView([{ path: 'src/client.ts', status: 'modified', reviewed: true }]);
    await user.click(await screen.findByRole('button', { name: 'Files' }));
    expect(screen.getByRole('checkbox', { name: 'Review src/client.ts' })).toBeChecked();
    reviewed.unmount();

    const reset = renderView([{ path: 'src/client.ts', status: 'modified', reviewed: false }]);
    await user.click(await screen.findByRole('button', { name: 'Files' }));
    expect(screen.getByRole('checkbox', { name: 'Review src/client.ts' })).not.toBeChecked();
    reset.unmount();
  });
});

describe('Review diff tab', () => {
  it('opens a file from the files tab into the per-file diff', async () => {
    const user = userEvent.setup();
    renderView([{ path: 'src/client.ts', status: 'modified' }, { path: 'src/auth/session.ts', status: 'modified' }]);
    await user.click(await screen.findByRole('button', { name: 'Files' }));
    await user.click(screen.getByRole('button', { name: /src\/client\.ts/ }));
    expect(await screen.findByText('diff --git a/src/client.ts b/src/client.ts')).toBeInTheDocument();
  });

  it('navigates per-file diffs with next and previous', async () => {
    const user = userEvent.setup();
    renderView([{ path: 'a.ts', status: 'modified' }, { path: 'b.ts', status: 'modified' }, { path: 'c.ts', status: 'added' }]);
    await user.click(await screen.findByRole('button', { name: 'Diff' }));
    const select = await screen.findByLabelText('Changed file') as HTMLSelectElement;
    expect(select.value).toBe('a.ts');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(select.value).toBe('b.ts');
    expect(await screen.findByText('diff --git a/b.ts b/b.ts')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(select.value).toBe('c.ts');

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(select.value).toBe('b.ts');
  });
});
