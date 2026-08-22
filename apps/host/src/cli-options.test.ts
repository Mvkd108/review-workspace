import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultDataDirectory, parseArgs } from './cli-options.js';

// An absolute path on the platform running the suite. A hardcoded Windows path
// is only absolute on Windows, so path.resolve would prefix the real cwd
// elsewhere and the assertion would describe the runner rather than the parser.
const cwd = process.platform === 'win32' ? 'C:\\workspace' : '/workspace';

describe('CLI options', () => {
  it('ignores pnpm argument separators', () => {
    const options = parseArgs(['--', '--data-dir', '.review-data'], cwd);

    expect(options.dataDirectory).toBe(path.resolve(cwd, '.review-data'));
  });

  it('resolves a relative data directory against the working directory', () => {
    expect(parseArgs(['--data-dir', 'nested/data'], cwd).dataDirectory).toBe(path.resolve(cwd, 'nested/data'));
  });

  it('keeps an absolute data directory as-is', () => {
    const absolute = path.resolve(cwd, 'abs', 'data');
    expect(parseArgs(['--data-dir', absolute], cwd).dataDirectory).toBe(absolute);
  });

  it('defaults to the OS application-data directory rather than the working directory', () => {
    const options = parseArgs([], cwd);
    expect(options.dataDirectory).toBe(defaultDataDirectory());
    expect(options.dataDirectory.startsWith(cwd)).toBe(false);
    expect(options.port).toBe(4317);
  });

  it('prefers the pnpm invocation directory over process.cwd() for a relative data directory', () => {
    const previous = process.env.INIT_CWD;
    const invocation = path.resolve(cwd, 'invocation');
    process.env.INIT_CWD = invocation;
    try {
      const options = parseArgs(['--data-dir', '.review-workspace']);
      expect(options.dataDirectory).toBe(path.resolve(invocation, '.review-workspace'));
    } finally {
      if (previous === undefined) delete process.env.INIT_CWD;
      else process.env.INIT_CWD = previous;
    }
  });

  it('rejects a port outside the valid range', () => {
    expect(() => parseArgs(['--port', '70000'], cwd)).toThrow(/between 0 and 65535/);
    expect(() => parseArgs(['--port', 'http'], cwd)).toThrow(/between 0 and 65535/);
  });

  it('refuses LAN binding rather than silently ignoring it', () => {
    expect(() => parseArgs(['--lan'], cwd)).toThrow(/pairing/);
  });

  it('points an unknown option at the help output', () => {
    expect(() => parseArgs(['--bogus'], cwd)).toThrow(/--help/);
  });
});
