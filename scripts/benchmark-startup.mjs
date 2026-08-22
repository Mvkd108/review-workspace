#!/usr/bin/env node
// Startup benchmark for the M2 incremental-refresh target.
//
// Builds a reference dataset (~20 worktrees, several with 500-file generated
// diffs), registers them once, then measures a cold host start against the
// persisted database:
//   shell   - time until the SPA shell answers HTTP 200        (target < 2s)
//   partial - time until a snapshot with at least one work unit (target < 5s)
//   fresh   - time until every work unit is inspected
//
// Usage: node scripts/benchmark-startup.mjs   (requires `pnpm build` first)

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const WORKTREE_COUNT = 20;
const LARGE_DIFF_COUNT = 5;
const LARGE_FILES = 500;
const SHELL_TARGET_MS = 2_000;
const PARTIAL_TARGET_MS = 5_000;

function runSync(cwd, args) {
  const result = spawnSync('git', ['-c', `safe.directory=${cwd}`, ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`command failed: git ${args.join(' ')}\n${result.stderr}`);
  return result.stdout;
}

async function waitFor(predicate, timeoutMs, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return predicate();
}

async function jsonRequest(port, pathname, options) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options ?? {});
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text; // the SPA shell serves HTML, not JSON
  }
  return { status: response.status, body };
}

async function main() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'review-workspace-bench-'));
  const port = 43_417;
  const dataDir = path.join(root, 'host-data');
  const worktreeBase = path.join(root, 'worktrees');
  let host = null;

  const stopHost = () => {
    if (host && !host.killed) host.kill('SIGTERM');
    host = null;
  };

  try {
    console.log('Building the reference dataset...');
    const base = path.join(root, 'base-repo');
    mkdirSync(base, { recursive: true });
    runSync(base, ['init', '-b', 'main']);
    runSync(base, ['config', 'user.name', 'Benchmark']);
    runSync(base, ['config', 'user.email', 'bench@example.test']);
    writeFileSync(path.join(base, 'value.txt'), 'base\n');
    runSync(base, ['add', '.']);
    runSync(base, ['commit', '-m', 'base']);

    mkdirSync(worktreeBase, { recursive: true });
    const worktrees = [];
    for (let index = 0; index < WORKTREE_COUNT; index += 1) {
      const worktree = path.join(worktreeBase, `wt-${index}`);
      runSync(base, ['worktree', 'add', '-b', `feature-${index}`, worktree]);
      if (index < LARGE_DIFF_COUNT) {
        const generated = path.join(worktree, 'dist', 'gen');
        mkdirSync(generated, { recursive: true });
        for (let file = 0; file < LARGE_FILES; file += 1) {
          writeFileSync(path.join(generated, `schema-${String(file).padStart(3, '0')}.d.ts`), `export type GenSchema${String(file).padStart(3, '0')} = unknown;\n`);
        }
      } else {
        writeFileSync(path.join(worktree, 'note.txt'), `change for ${index}\n`);
      }
      worktrees.push(worktree);
    }
    console.log(`  ${WORKTREE_COUNT} worktrees, ${LARGE_DIFF_COUNT} with ${LARGE_FILES}-file diffs.`);

    const startHost = () => {
      const child = spawn(process.execPath, ['apps/host/dist/cli.js', '--data-dir', dataDir, '--port', String(port)], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout.on('data', (chunk) => process.stdout.write(chunk));
      child.stderr.on('data', (chunk) => process.stderr.write(chunk));
      child.once('exit', (code, signal) => console.log(`host exited with code ${code} signal ${signal}`));
      return child;
    };

    console.log('Registering the dataset once...');
    host = startHost();
    await waitFor(async () => {
      try {
        return (await jsonRequest(port, '/api/v1/workspace')).status === 200;
      } catch {
        return false; // host is still binding the port
      }
    }, 30_000);
    for (const [index, worktree] of worktrees.entries()) {
      const t0 = Date.now();
      try {
        const result = await jsonRequest(port, '/api/v1/work-units', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ task: `Benchmark unit ${path.basename(worktree)}`, worktreePath: worktree, baseRef: 'main' }),
        });
        if (result.status !== 201) throw new Error(`register failed (${result.status}): ${JSON.stringify(result.body)}`);
        console.log(`  registered ${index} ${path.basename(worktree)} in ${Date.now() - t0} ms`);
      } catch (error) {
        console.error(`register ${index} ${path.basename(worktree)} FAILED in ${Date.now() - t0} ms: ${error?.message}`);
        console.error(error?.stack);
        throw error;
      }
    }
    stopHost();
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    console.log('Measuring cold start against the persisted database...');
    const started = Date.now();
    host = startHost();
    const shellMs = await waitFor(async () => {
      try {
        return (await jsonRequest(port, '/')).status === 200;
      } catch {
        return false; // host is still binding the port
      }
    }, 30_000);
    const shellAt = Date.now() - started;

    let partialAt = 0;
    await waitFor(async () => {
      try {
        const { status, body } = await jsonRequest(port, '/api/v1/workspace');
        if (status !== 200 || !body || !Array.isArray(body.workUnits) || body.workUnits.length === 0) return false;
        partialAt = Date.now() - started;
        return true;
      } catch {
        return false;
      }
    }, 60_000);

    let freshAt = 0;
    await waitFor(async () => {
      try {
        const { body } = await jsonRequest(port, '/api/v1/workspace');
        if (!body || body.status !== 'fresh') return false;
        if (body.workUnits.length !== WORKTREE_COUNT) return false;
        freshAt = Date.now() - started;
        return true;
      } catch {
        return false;
      }
    }, 120_000);

    stopHost();
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const line = (label, ms, target) =>
      `${label.padEnd(9)} ${String(ms).padStart(6)} ms  ${ms <= target ? 'PASS' : 'FAIL'} (target ${target} ms)`;
    console.log('');
    console.log(line('shell', shellAt, SHELL_TARGET_MS));
    console.log(line('partial', partialAt, PARTIAL_TARGET_MS));
    console.log(line('fresh', freshAt, Number.POSITIVE_INFINITY));

    const ok = shellAt <= SHELL_TARGET_MS && partialAt <= PARTIAL_TARGET_MS;
    console.log(ok ? '\nAcceptance targets met.' : '\nAcceptance targets NOT met.');
    process.exitCode = ok ? 0 : 1;
  } finally {
    stopHost();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
