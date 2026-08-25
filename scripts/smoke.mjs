#!/usr/bin/env node
// Packed-install smoke test (M8). Exercises the compiled CLI as the shipped
// artifact would run it — version, help, the HTTP surface, and the publishable
// package shape — from a clean, temporary data directory.
//
// Requires `pnpm build` first (host dist + copied web assets + schema docs).

import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cli = path.join(root, 'apps', 'host', 'dist', 'cli.js');
const schemaDoc = path.join(root, 'apps', 'host', 'dist', 'assets', 'workspace.schema.json');

let failed = false;
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS ${label}`);
  else {
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    failed = true;
  }
}

function runSync(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function jsonRequest(port, pathname, options) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, options);
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return predicate();
}

async function main() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'review-workspace-smoke-'));
  const port = 43_411;
  let hostProcess = null;
  const stopHost = () => {
    if (hostProcess && !hostProcess.killed) hostProcess.kill('SIGTERM');
    hostProcess = null;
  };

  try {
    if (!existsSync(cli)) throw new Error(`built CLI not found at ${cli}. Run \`pnpm build\` first.`);
    const expectedVersion = JSON.parse(readFileSync(schemaDoc, 'utf8')).properties.schemaVersion.const;

    console.log('CLI surface');
    const dataDir = path.join(tmp, 'cli-data');
    const version = runSync(process.execPath, [cli, '--data-dir', dataDir, '--version']);
    check('--version exits 0', version.status === 0);
    check('--version prints the schema version', version.stdout.trim() === expectedVersion, `got "${version.stdout.trim()}"`);

    const help = runSync(process.execPath, [cli, '--data-dir', dataDir, '--help']);
    check('--help exits 0', help.status === 0);
    check('--help prints usage', /Usage/.test(help.stdout));

    check('unknown option exits nonzero', runSync(process.execPath, [cli, '--data-dir', dataDir, '--bogus']).status !== 0);
    check('--lan is refused', runSync(process.execPath, [cli, '--data-dir', dataDir, '--lan']).status !== 0);
    check('no database is opened by the CLI surface', !existsSync(path.join(dataDir, 'review-workspace.db')));

    console.log('HTTP surface');
    hostProcess = spawn(process.execPath, [cli, '--data-dir', path.join(tmp, 'host-data'), '--port', String(port)], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    hostProcess.stdout.on('data', (chunk) => process.stdout.write(chunk));
    hostProcess.stderr.on('data', (chunk) => process.stderr.write(chunk));

    const ready = await waitFor(async () => {
      try {
        return (await jsonRequest(port, '/api/v1/workspace')).ok;
      } catch {
        return false; // daemon is still binding the port
      }
    }, 30_000);
    check('daemon serves /api/v1/workspace', ready);

    const workspace = await jsonRequest(port, '/api/v1/workspace');
    const snapshot = await workspace.json();
    check('first-run snapshot is an empty workspace', Array.isArray(snapshot.workUnits) && snapshot.workUnits.length === 0);
    check('snapshot carries the current schema version', snapshot.schemaVersion === expectedVersion);

    const shell = await jsonRequest(port, '/');
    check('shell serves the SPA HTML', shell.ok && (await shell.text()).includes('<div id="root">'));

    const schema = await jsonRequest(port, '/workspace.schema.json');
    check('JSON Schema document serves', schema.ok && (await schema.json()).properties.schemaVersion.const === expectedVersion);

    const openapi = await jsonRequest(port, '/openapi.json');
    check('OpenAPI document serves', openapi.ok && (await openapi.json()).info.version === expectedVersion);

    // Unmatched GET routes fall through to the SPA shell by design (client-side
    // routing), so an unknown route must serve the shell, never a JSON API body.
    const unknown = await jsonRequest(port, '/api/v1/nope');
    check('unknown GET route serves the SPA shell, not an API body', unknown.status === 200 && (await unknown.text()).includes('<div id="root">'));

    console.log('Package shape');
    const pack = process.platform === 'win32'
      ? runSync('cmd.exe', ['/d', '/s', '/c', 'pnpm --filter @review-workspace/host pack --dry-run'], { cwd: root })
      : runSync('pnpm', ['--filter', '@review-workspace/host', 'pack', '--dry-run'], { cwd: root });
    check('pnpm pack --dry-run succeeds', pack.status === 0, pack.stderr);
    if (pack.status === 0) {
      check('package excludes test artifacts', !/\.test\.(js|d\.ts)/.test(pack.stdout), 'test files are still in the tarball');
      check('package includes the CLI entry', /dist\/cli\.js/.test(pack.stdout));
    }

    if (failed) process.exitCode = 1;
    else console.log('\nSmoke test passed.');
  } finally {
    stopHost();
    await new Promise((resolve) => setTimeout(resolve, 500));
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
