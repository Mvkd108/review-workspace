import { describe, expect, it } from 'vitest';
import { parseArgs } from './cli-options.js';

describe('CLI options', () => {
  it('ignores pnpm argument separators', () => {
    const options = parseArgs(['--', '--data-dir', '.review-data'], 'C:\\workspace');

    expect(options.dataDirectory).toBe('C:\\workspace\\.review-data');
  });
});
