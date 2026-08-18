#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { parseArgs } from './cli-options.js';
import { WorkspaceStore } from './store.js';
import { WorkspaceService } from './workspace-service.js';
import { startServer } from './server.js';

function openBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false }).unref();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const service = new WorkspaceService(new WorkspaceStore(options.dataDirectory));
  await service.start();
  const server = await startServer(service, '127.0.0.1', options.port);
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
