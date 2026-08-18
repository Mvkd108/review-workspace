import path from 'node:path';

export interface CliOptions {
  dataDirectory: string;
  port: number;
  open: boolean;
  lan: boolean;
}

export function parseArgs(args: readonly string[], cwd = process.cwd()): CliOptions {
  const options: CliOptions = {
    dataDirectory: path.resolve(cwd, '.review-workspace'),
    port: 4317,
    open: false,
    lan: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--data-dir') options.dataDirectory = path.resolve(cwd, args[++index] ?? '');
    else if (argument === '--port') options.port = Number.parseInt(args[++index] ?? '', 10);
    else if (argument === '--open') options.open = true;
    else if (argument === '--lan') options.lan = true;
    else if (argument === '--help' || argument === '-h') {
      console.log('review-workspace [--data-dir PATH] [--port PORT] [--open]\n\n--lan is reserved until Phase 0b pairing and device security are implemented.');
      process.exit(0);
    } else throw new Error(`Unknown option: ${argument}`);
  }

  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('Port must be between 0 and 65535.');
  if (options.lan) throw new Error('LAN binding is disabled until Phase 0b pairing, lockout, and device revocation are implemented.');
  return options;
}
