import { describe, expect, it } from 'vitest';
import type { ChangeSummary, GateDefinition, GateRun } from '@review-workspace/schema';
import { assessRisk } from './risk.js';

const change: ChangeSummary = {
  baseCommit: 'base', headCommit: 'head', branch: 'feature', dirty: false,
  ahead: 1, behind: 0, additions: 40, deletions: 3,
  files: [
    { path: 'src/auth/session.ts', status: 'modified', additions: 40, deletions: 0, binary: false, reviewed: false },
    { path: 'pnpm-lock.yaml', status: 'modified', additions: 0, deletions: 3, binary: false, reviewed: false },
  ],
  topLevelAreas: ['src', 'pnpm-lock.yaml'], trackedDiffHash: 'tracked', untrackedContentHash: 'untracked',
  fingerprint: 'fingerprint', lastChangedAt: new Date().toISOString(),
};

const gate: GateDefinition = {
  id: 'test', repositoryId: 'repo', name: 'Tests', program: 'pnpm.cmd', args: ['test'],
  envAllowlist: [], timeoutMs: 1000, required: true, definitionHash: 'definition', approvedAt: new Date().toISOString(),
};

describe('deterministic risk assessment', () => {
  it('shows concrete reasons while keeping the numeric signal as a sort key', () => {
    const risk = assessRisk({
      change,
      scope: { allowedGlobs: ['src/api/**'], inferredPathTokens: [], confirmed: true },
      baseMissing: false,
      mergeConflict: false,
      gates: [gate],
      latestRuns: new Map(),
    });
    expect(risk.level).toBe('high');
    expect(risk.reasons.map((item) => item.code)).toEqual(expect.arrayContaining([
      'scope.outside-glob', 'change.sensitive', 'change.no-tests', 'gate.stale.test',
    ]));
    expect(risk.sortScore).toBeLessThanOrEqual(100);
  });

  it('treats a gate result as current only for the exact definition and diff', () => {
    const run: GateRun = {
      id: 'run', gateId: gate.id, workUnitId: 'unit', status: 'passed', definitionHash: gate.definitionHash,
      worktreeFingerprint: change.fingerprint, startedAt: new Date().toISOString(), output: '',
    };
    const current = assessRisk({ change, scope: { allowedGlobs: [], inferredPathTokens: [], confirmed: false }, baseMissing: false, mergeConflict: false, gates: [gate], latestRuns: new Map([[gate.id, run]]) });
    expect(current.reasons.some((item) => item.code.startsWith('gate.'))).toBe(false);
    const stale = assessRisk({ change: { ...change, fingerprint: 'changed' }, scope: { allowedGlobs: [], inferredPathTokens: [], confirmed: false }, baseMissing: false, mergeConflict: false, gates: [gate], latestRuns: new Map([[gate.id, run]]) });
    expect(stale.reasons.some((item) => item.code === 'gate.stale.test')).toBe(true);
  });
});
