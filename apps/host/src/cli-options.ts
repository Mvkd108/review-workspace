import os from 'node:os';
import path from 'node:path';
import { WORKSPACE_SCHEMA_VERSION } from '@review-workspace/schema';

export interface CliOptions {
  dataDirectory: string;
  port: number;
  open: boolean;
  lan: boolean;
}

export function defaultDataDirectory(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'review-workspace');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'review-workspace');
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'review-workspace');
}

const HELP = `review-workspace — review what coding agents actually did

Usage
  review-workspace [options]

Options
  --data-dir PATH   Host-owned storage for gates and review state
                    (default: ${defaultDataDirectory()})
  --port PORT       Port to listen on (default: 4317)
  --open            Open the workspace in your browser once it is ready
  --version         Print the workspace schema version
  -h, --help        Show this message

The server binds to 127.0.0.1 only. --lan is reserved until pairing, lockout,
and device revocation exist; it is refused rather than silently ignored.

A relative --data-dir resolves against the directory pnpm was invoked from
(INIT_CWD), so the root start command behaves the same as a direct invocation.

Gate definitions are stored in --data-dir, outside any observed worktree, so a
branch cannot alter the checks that judge it.`;

export function parseArgs(args: readonly string[], cwd = process.env.INIT_CWD ?? process.cwd()): CliOptions {
  const options: CliOptions = {
    dataDirectory: defaultDataDirectory(),
    port: 4317,
    open: false,
    lan: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--data-dir') {
      const value = args[++index] ?? '';
      options.dataDirectory = path.isAbsolute(value) ? value : path.resolve(cwd, value);
    } else if (argument === '--port') options.port = Number.parseInt(args[++index] ?? '', 10);
    else if (argument === '--open') options.open = true;
    else if (argument === '--lan') options.lan = true;
    else if (argument === '--help' || argument === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (argument === '--version' || argument === '-v') {
      console.log(WORKSPACE_SCHEMA_VERSION);
      process.exit(0);
    } else throw new Error(`Unknown option: ${argument}\n\nRun review-workspace --help to see the available options.`);
  }

  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('Port must be between 0 and 65535.');
  if (options.lan) throw new Error('LAN binding is disabled until Phase 0b pairing, lockout, and device revocation are implemented.');
  return options;
}
