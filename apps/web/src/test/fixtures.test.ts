import { describe, expect, it } from 'vitest';
import { WORKSPACE_SCHEMA_VERSION } from '@review-workspace/schema';
import { fixtures, fixtureByName, buildView, snapshot } from '../fixtures/workspaces';

describe('snapshot fixtures', () => {
  it('has unique names and covers every scenario', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
    const names = fixtures.map((fixture) => fixture.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('produces well-formed snapshots', () => {
    for (const fixture of fixtures) {
      expect(fixture.snapshot.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
      expect(fixture.snapshot.seq).toBeGreaterThan(0);
      expect(Array.isArray(fixture.snapshot.workUnits)).toBe(true);
    }
  });

  it('represents the empty workspace', () => {
    expect(fixtureByName('Empty workspace').snapshot.workUnits).toHaveLength(0);
  });

  it('represents a 500-file change without a diff row explosion', () => {
    const fixture = fixtureByName('500 changed files');
    const view = fixture.snapshot.workUnits[0]!;
    expect(view.change!.files).toHaveLength(500);
    expect(fixture.diff!.split('\n').length).toBeLessThan(500);
  });

  it('covers every check state', () => {
    const missing = fixtureByName('Missing checks').snapshot.workUnits[0]!;
    expect(missing.gateRuns).toHaveLength(0);
    expect(missing.mergeReadiness.status).toBe('blocked');

    const failed = fixtureByName('Failed checks').snapshot.workUnits[0]!;
    expect(failed.gateRuns[0]!.status).toBe('failed');
    expect(failed.mergeReadiness.status).toBe('blocked');

    const passed = fixtureByName('Passed checks').snapshot.workUnits[0]!;
    expect(passed.gateRuns.every((candidate) => candidate.status === 'passed')).toBe(true);
    expect(passed.mergeReadiness.status).toBe('ready');

    const stale = fixtureByName('Stale checks').snapshot.workUnits[0]!;
    expect(stale.gateRuns[0]!.status).toBe('stale');
    expect(stale.mergeReadiness.status).toBe('blocked');
  });

  it('covers every agent state as a distinct fixture', () => {
    const byName = new Map(fixtures.map((fixture) => [fixture.name, fixture.snapshot.workUnits[0]?.agentActivity]));
    expect(byName.get('Agent working')?.state).toBe('working');
    expect(byName.get('Agent stalled')?.state).toBe('stalled');
    expect(byName.get('One healthy work unit')?.state).toBe('idle');
    expect(byName.get('Agent no signal')?.state).toBe('unknown');
  });

  it('never records transcript paths or payload on agent sessions', () => {
    for (const fixture of fixtures) {
      for (const view of fixture.snapshot.workUnits) {
        for (const session of view.agentActivity.sessions) {
          expect(Object.keys(session).sort()).toEqual(['agentLabel', 'cwd', 'lastActivityAt', 'lastTurnComplete', 'sessionId', 'state']);
          expect(JSON.stringify(session)).not.toMatch(/\.claude|\.codex|sourcePath|\.jsonl/);
        }
      }
    }
  });

  it('represents archived work retained but quiet', () => {
    const view = fixtureByName('Archived work').snapshot.workUnits[0]!;
    expect(view.workUnit.visibility).toBe('archived');
    expect(view.workUnit.lifecycle).toBe('observing');
    expect(view.change!.files).toHaveLength(0);
    expect(view.queueTier).toBe(3);
  });

  it('represents a missing worktree as unavailable', () => {
    const view = fixtureByName('Missing worktree').snapshot.workUnits[0]!;
    expect(view.workUnit.lifecycle).toBe('unavailable');
    expect(view.change).toBeNull();
    expect(view.queueTier).toBe(0);
    expect(view.risk.level).toBe('high');
  });

  it('builds views for composition tests', () => {
    const two = snapshot([buildView({ id: 'x', task: 'X' }), buildView({ id: 'y', task: 'Y' })]);
    expect(two.workUnits.map((view) => view.workUnit.id)).toEqual(['x', 'y']);
  });

  it('represents the nineteen-unit dataset across repositories', () => {
    const mixed = fixtureByName('19 work units across repositories');
    expect(mixed.snapshot.workUnits).toHaveLength(19);
    const active = mixed.snapshot.workUnits.filter((view) => view.workUnit.visibility !== 'archived');
    const archived = mixed.snapshot.workUnits.filter((view) => view.workUnit.visibility === 'archived');
    expect(active).toHaveLength(16);
    expect(archived).toHaveLength(3);
    expect(new Set(mixed.snapshot.workUnits.map((view) => view.workUnit.repositoryId)).size).toBe(3);
  });
});
