import { minimatch } from 'minimatch';
import type { ChangeSummary, GateDefinition, GateRun, RiskAssessment, RiskReason, TaskScope } from '@review-workspace/schema';

const SENSITIVE = [
  /(^|\/)(migrations?|schema)(\/|$)/i,
  /(^|\/)(auth|security|permissions?)(\/|$)/i,
  /(^|\/)(\.github|\.gitlab|ci|scripts?)(\/|$)/i,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|cargo\.lock|go\.sum)$/i,
  /(^|\/)(dockerfile|compose\.ya?ml|vite\.config|webpack\.config|tsconfig)/i,
];
const TEST_FILE = /(^|\/)(__tests__|tests?|spec)(\/|\.|$)|\.(test|spec)\.[^.]+$/i;
const PRODUCTION_CODE = /\.(ts|tsx|js|jsx|py|go|rs|java|kt|swift|cs|cpp|c|rb|php)$/i;

function reason(code: string, label: string, detail: string, weight: number): RiskReason {
  return { code, label, detail, weight };
}

export interface RiskInput {
  change: ChangeSummary;
  scope: TaskScope;
  baseMissing: boolean;
  mergeConflict: boolean | null;
  gates: readonly GateDefinition[];
  latestRuns: ReadonlyMap<string, GateRun>;
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const reasons: RiskReason[] = [];
  const { change, scope } = input;

  if (scope.confirmed && scope.allowedGlobs.length > 0) {
    const outside = change.files.filter((file) => !scope.allowedGlobs.some((glob) => minimatch(file.path, glob, { dot: true })));
    if (outside.length > 0) reasons.push(reason('scope.outside-glob', 'Outside stated scope', `${outside.length} changed file${outside.length === 1 ? '' : 's'} do not match the confirmed scope.`, 28));
  } else {
    const strongTokens = scope.inferredPathTokens.filter((token) => token.includes('/') || token.includes('\\') || token.includes('.'));
    const matched = change.files.filter((file) => strongTokens.some((token) => file.path.toLowerCase().includes(token.toLowerCase().replaceAll('\\', '/'))));
    if (strongTokens.length > 0 && matched.length > 0 && matched.length < change.files.length) {
      reasons.push(reason('scope.task-path', 'Task path mismatch', `${change.files.length - matched.length} file${change.files.length - matched.length === 1 ? '' : 's'} fall outside paths named in the task.`, 18));
    }
  }

  const deletions = change.files.filter((file) => file.status === 'deleted' || file.status === 'renamed');
  if (deletions.length > 0) reasons.push(reason('change.destructive', 'Deletes or renames files', `${deletions.length} file${deletions.length === 1 ? '' : 's'} deleted or renamed.`, 16));

  const sensitive = change.files.filter((file) => SENSITIVE.some((pattern) => pattern.test(file.path)));
  if (sensitive.length > 0) reasons.push(reason('change.sensitive', 'Touches sensitive project surfaces', sensitive.slice(0, 4).map((file) => file.path).join(', '), 22));

  const codeChanged = change.files.some((file) => PRODUCTION_CODE.test(file.path) && !TEST_FILE.test(file.path));
  const testsChanged = change.files.some((file) => TEST_FILE.test(file.path));
  if (codeChanged && !testsChanged) reasons.push(reason('change.no-tests', 'Code changed without tests', 'No corresponding test file changed in this work unit.', 14));

  if (change.files.length >= 15 || change.additions + change.deletions >= 500) {
    reasons.push(reason('change.large', 'Large review surface', `${change.files.length} files and ${change.additions + change.deletions} changed lines.`, 18));
  }
  if (change.topLevelAreas.length >= 4) reasons.push(reason('change.broad', 'Crosses several project areas', change.topLevelAreas.slice(0, 6).join(', '), 14));
  if (input.baseMissing) reasons.push(reason('git.base-missing', 'Base reference is unavailable', 'Merge safety cannot be calculated until the base reference resolves.', 30));
  if (input.mergeConflict === true) reasons.push(reason('git.conflict', 'Conflicts with the base branch', 'Git reports a merge conflict without modifying the worktree.', 35));

  for (const gate of input.gates.filter((candidate) => candidate.required)) {
    const run = input.latestRuns.get(gate.id);
    const stale = !run || run.definitionHash !== gate.definitionHash || run.worktreeFingerprint !== change.fingerprint;
    if (stale) reasons.push(reason(`gate.stale.${gate.id}`, `${gate.name} needs a current result`, 'The trusted gate has not passed for this exact diff and definition.', 16));
    else if (run.status !== 'passed') reasons.push(reason(`gate.failed.${gate.id}`, `${gate.name} failed`, 'A required trusted gate did not pass.', 28));
  }

  const sortScore = Math.min(100, reasons.reduce((sum, item) => sum + item.weight, 0));
  return { level: sortScore >= 60 ? 'high' : sortScore >= 30 ? 'medium' : 'low', reasons, sortScore };
}
