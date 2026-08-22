#!/usr/bin/env node
// Must stay first. Node loads builtin modules while linking the import graph,
// before any user module evaluates, so the filter has to be installed before
// anything reaching node:sqlite is imported. That is why the store, service, and
// server below are loaded dynamically rather than at the top of this file: it
// also means --help and --version never open a database at all.
import './quiet-sqlite-warning.js';
import { spawn } from 'node:child_process';
import { parseArgs } from './cli-options.js';

function openBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false }).unref();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const [{ WorkspaceStore }, { WorkspaceService }, { startServer }] = await Promise.all([
    import('./store.js'),
    import('./workspace-service.js'),
    import('./server.js'),
  ]);

  const service = new WorkspaceService(new WorkspaceStore(options.dataDirectory));
  // Serve the shell before the first Git pass so the UI is available within the
  // contract's two-second target; reconciliation publishes partial snapshots.
  const server = await startServer(service, '127.0.0.1', options.port);
  try {
    await service.start();
  } catch (error) {
    await server.close();
    throw error;
  }
  console.log(`Review Workspace is ready at ${server.url}`);
  console.log(`Host-owned data: ${options.dataDirectory}`);
  if (options.open) openBrowser(server.url);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.close();
    await service.stop();
  };
  process.once('SIGINT', () => void stop().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void stop().finally(() => process.exit(0)));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
