import { realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * Canonical absolute form of a path, for comparison and for identity.
 *
 * Windows exposes one directory under both an 8.3 short alias
 * (`C:\Users\RUNNER~1`) and its long form (`C:\Users\runneradmin`), and
 * `path.resolve` preserves whichever spelling it was handed. Two references to
 * the same directory can therefore compare unequal, which makes a containment
 * guard fail open and gives one repository two identities. Resolving through the
 * filesystem collapses the alias, and on POSIX collapses symlinks for the same
 * reason.
 *
 * The native resolver is required: Node's JavaScript `realpath` walks symlinks
 * but does not expand a short name.
 *
 * A path that does not exist cannot be canonicalised — an unavailable worktree
 * is a normal state here — so the resolved form is returned as the best
 * available answer.
 */
export function canonicalPath(pathname: string): string {
  const absolute = path.resolve(pathname);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

/**
 * Canonical form suitable for comparing two paths. Windows filesystems are
 * case-insensitive, so case must not decide whether one path contains another.
 */
export function comparablePath(pathname: string): string {
  const canonical = canonicalPath(pathname);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

/** True when `candidate` is `directory` itself or lives under it. */
export function isWithinPath(candidate: string, directory: string): boolean {
  const relative = path.relative(comparablePath(directory), comparablePath(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
