import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalPath, comparablePath, isWithinPath } from './paths.js';

const temporary: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-paths-'));
  temporary.push(root);
  return root;
}

describe('Path canonicalisation', () => {
  it('resolves the same directory to one form however it was reached', async () => {
    const root = await temporaryDirectory();
    const nested = path.join(root, 'a', 'b');
    await mkdir(nested, { recursive: true });

    const indirect = path.join(root, 'a', '..', 'a', 'b');
    expect(canonicalPath(indirect)).toBe(canonicalPath(nested));
  });

  it('returns the resolved form for a path that does not exist', () => {
    const missing = path.join(os.tmpdir(), 'review-workspace-absent-0f1e2d');
    expect(canonicalPath(missing)).toBe(path.resolve(missing));
  });

  it('agrees on containment when os.tmpdir() and its canonical form differ', async () => {
    // On CI Windows runners os.tmpdir() is an 8.3 alias (C:\Users\RUNNER~1\...)
    // while Git and the filesystem report the long name. A guard comparing the
    // two spellings with path.resolve alone answers "not contained" and fails
    // open. Where the two forms already agree this simply restates containment.
    const root = await temporaryDirectory();
    const inside = path.join(root, 'data');
    await mkdir(inside, { recursive: true });

    expect(isWithinPath(inside, root)).toBe(true);
    expect(isWithinPath(canonicalPath(inside), root)).toBe(true);
    expect(isWithinPath(inside, canonicalPath(root))).toBe(true);
    expect(isWithinPath(canonicalPath(inside), canonicalPath(root))).toBe(true);
  });

  it('treats a directory as containing itself but not its sibling', async () => {
    const root = await temporaryDirectory();
    const alpha = path.join(root, 'alpha');
    const alphaSuffix = path.join(root, 'alpha-two');
    await mkdir(alpha, { recursive: true });
    await mkdir(alphaSuffix, { recursive: true });

    expect(isWithinPath(alpha, alpha)).toBe(true);
    expect(isWithinPath(alphaSuffix, alpha)).toBe(false);
  });

  it('lower-cases only on Windows, where the filesystem ignores case', () => {
    const sample = path.resolve(os.tmpdir(), 'Review-Workspace-Case');
    const comparable = comparablePath(sample);
    expect(comparable).toBe(process.platform === 'win32' ? comparable.toLowerCase() : canonicalPath(sample));
  });
});
