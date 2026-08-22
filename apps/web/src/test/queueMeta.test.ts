import { describe, expect, it } from 'vitest';
import { fixtureByName } from '../fixtures/workspaces';
import { filterViews, groupByRepository, matchesQuery, rowMeta, viewContains } from '../features/workspace-queue/queueMeta';

describe('queue view membership', () => {
  const mixed = fixtureByName('19 work units across repositories').snapshot.workUnits;
  const attention = mixed.filter((view) => viewContains(view, 'attention'));
  const progress = mixed.filter((view) => viewContains(view, 'progress'));
  const ready = mixed.filter((view) => viewContains(view, 'ready'));
  const active = mixed.filter((view) => viewContains(view, 'active'));
  const archived = mixed.filter((view) => viewContains(view, 'archived'));

  it('assigns the nineteen-unit dataset across the five views', () => {
    expect(mixed).toHaveLength(19);
    expect(attention).toHaveLength(6);
    expect(progress).toHaveLength(2);
    expect(ready).toHaveLength(3);
    expect(active).toHaveLength(16);
    expect(archived).toHaveLength(3);
  });

  it('keeps archived work out of the attention queue', () => {
    expect(archived.some((view) => attention.some((item) => item.workUnit.id === view.workUnit.id))).toBe(false);
    expect(archived.map((view) => view.workUnit.task)).toEqual(['Retired cache invalidation spike', 'Retired login theming spike', 'Retired emoji flag spike']);
  });

  it('excludes informational agent activity from attention', () => {
    expect(viewContains(fixtureByName('Agent working').snapshot.workUnits[0]!, 'attention')).toBe(false);
    expect(viewContains(fixtureByName('Agent working').snapshot.workUnits[0]!, 'progress')).toBe(true);
  });
});

describe('queue filtering and grouping', () => {
  const mixed = fixtureByName('19 work units across repositories').snapshot.workUnits;

  it('filters by view and query', () => {
    expect(filterViews(mixed, 'active', '')).toHaveLength(16);
    expect(filterViews(mixed, 'active', 'rate limit').map((view) => view.workUnit.task)).toEqual(['Rate limiting middleware']);
    expect(filterViews(mixed, 'archived', 'emoji')).toHaveLength(1);
  });

  it('matches against task, branch, repository, and file paths', () => {
    const mixedView = mixed.find((view) => view.workUnit.task === 'Rate limiting middleware')!;
    expect(matchesQuery(mixedView, 'RATE')).toBe(true);
    expect(matchesQuery(mixedView, 'feature/rate-limit')).toBe(true);
    expect(matchesQuery(mixedView, 'api-gateway')).toBe(true);
    expect(matchesQuery(mixedView, 'src/api/client.ts')).toBe(true);
    expect(matchesQuery(mixedView, 'something-else')).toBe(false);
  });

  it('groups rows by repository with stable names', () => {
    const groups = groupByRepository(filterViews(mixed, 'active', ''));
    expect(groups.map((group) => group.name)).toEqual(['api-gateway', 'admin-console', 'cli-tool']);
    expect(groups.map((group) => group.views.length)).toEqual([7, 5, 4]);
  });
});

describe('row primary state and recommended action', () => {
  it('derives one state and one action per row', () => {
    expect(rowMeta(fixtureByName('Blocked work unit').snapshot.workUnits[0]!).state).toBe('Blocked');
    expect(rowMeta(fixtureByName('One healthy work unit').snapshot.workUnits[0]!).state).toBe('Ready');
    expect(rowMeta(fixtureByName('Agent working').snapshot.workUnits[0]!).state).toBe('In progress');
    expect(rowMeta(fixtureByName('Agent stalled').snapshot.workUnits[0]!).state).toBe('Stalled');
    expect(rowMeta(fixtureByName('Missing worktree').snapshot.workUnits[0]!).state).toBe('Unavailable');
    expect(rowMeta(fixtureByName('Missing checks').snapshot.workUnits[0]!).state).toBe('Blocked');
    expect(rowMeta(fixtureByName('Failed checks').snapshot.workUnits[0]!).state).toBe('Blocked');
    expect(rowMeta(fixtureByName('Archived work').snapshot.workUnits[0]!).state).toBe('Archived');
  });

  it('always provides a recommended next action', () => {
    const mixed = fixtureByName('19 work units across repositories').snapshot.workUnits;
    for (const view of mixed) {
      const meta = rowMeta(view);
      expect(meta.action.length).toBeGreaterThan(0);
      expect(meta.state.length).toBeGreaterThan(0);
    }
  });
});
