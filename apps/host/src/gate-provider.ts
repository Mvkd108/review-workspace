import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GateProvider } from '@review-workspace/adapter-api';
import type { GateDefinition, GateRun, WorkUnit } from '@review-workspace/schema';
import { runProcess } from './process.js';

const REQUIRED_RUNTIME_ENV = ['PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];

function gateEnvironment(allowlist: readonly string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of new Set([...REQUIRED_RUNTIME_ENV, ...allowlist])) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.REVIEW_WORKSPACE = '1';
  return env;
}

function gateCwd(workUnit: WorkUnit, requested?: string): string {
  const root = path.resolve(workUnit.worktreePath);
  const cwd = path.resolve(root, requested ?? '.');
  const relative = path.relative(root, cwd);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Gate working directory must remain inside the registered worktree.');
  }
  return cwd;
}

export class LocalProcessGateProvider implements GateProvider {
  async run(workUnit: WorkUnit, gate: GateDefinition, fingerprint: string): Promise<GateRun> {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    try {
      const result = await runProcess(gate.program, gate.args, {
        cwd: gateCwd(workUnit, gate.cwd),
        env: gateEnvironment(gate.envAllowlist),
        timeoutMs: gate.timeoutMs,
        maxOutputBytes: 1_000_000,
      });
      const output = [result.stdout, result.stderr, result.truncated ? '\n[output truncated]' : '', result.timedOut ? '\n[gate timed out]' : ''].join('').trim();
      return {
        id,
        gateId: gate.id,
        workUnitId: workUnit.id,
        status: result.exitCode === 0 ? 'passed' : 'failed',
        definitionHash: gate.definitionHash,
        worktreeFingerprint: fingerprint,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        output,
      };
    } catch (error) {
      return {
        id,
        gateId: gate.id,
        workUnitId: workUnit.id,
        status: 'error',
        definitionHash: gate.definitionHash,
        worktreeFingerprint: fingerprint,
        startedAt,
        finishedAt: new Date().toISOString(),
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
