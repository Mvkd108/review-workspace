import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readlink, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RepositoryAdapter, RepositoryInspection } from '@review-workspace/adapter-api';
import type { ChangeFile, ChangeFileStatus, WorkUnit } from '@review-workspace/schema';
import { sha256 } from './hash.js';
import { runGit } from './process.js';

export interface RepositoryIdentity {
  repositoryId: string;
  repositoryRoot: string;
  worktreePath: string;
  branch: string;
  headCommit: string;
  baseRef: string;
}

export class GitCommandError extends Error {
  constructor(message: string, readonly stderr: string, readonly exitCode: number) {
    super(message);
  }
}

async function gitText(cwd: string, args: readonly string[], allowFailure = false): Promise<string> {
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0 && !allowFailure) {
    throw new GitCommandError(`git ${args[0] ?? ''} failed`, result.stderr.trim(), result.exitCode);
  }
  return result.stdout.trim();
}

function normalizeGitPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function statusFromCode(code: string): ChangeFileStatus {
  if (code.startsWith('R')) return 'renamed';
  if (code.startsWith('C')) return 'copied';
  if (code.startsWith('A')) return 'added';
  if (code.startsWith('D')) return 'deleted';
  return 'modified';
}

function parseNameStatus(raw: string): ChangeFile[] {
  if (!raw) return [];
  const tokens = raw.split('\0').filter(Boolean);
  const files: ChangeFile[] = [];
  for (let index = 0; index < tokens.length;) {
    const code = tokens[index++] ?? 'M';
    const status = statusFromCode(code);
    if (status === 'renamed' || status === 'copied') {
      const previousPath = normalizeGitPath(tokens[index++] ?? '');
      const nextPath = normalizeGitPath(tokens[index++] ?? previousPath);
      files.push({ path: nextPath, previousPath, status, additions: 0, deletions: 0, binary: false, reviewed: false });
    } else {
      const filePath = normalizeGitPath(tokens[index++] ?? '');
      if (filePath) files.push({ path: filePath, status, additions: 0, deletions: 0, binary: false, reviewed: false });
    }
  }
  return files;
}

function addNumStats(files: ChangeFile[], raw: string): void {
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const line of raw.split(/\r?\n/)) {
    const [added, deleted, ...pathParts] = line.split('\t');
    if (!added || !deleted || pathParts.length === 0) continue;
    const rawPath = pathParts.join('\t');
    const normalized = normalizeGitPath(rawPath.replace(/^.* => /, '').replace(/[{}]/g, ''));
    const candidate = byPath.get(normalized) ?? files.find((file) => rawPath.includes(file.path));
    if (!candidate) continue;
    candidate.binary = added === '-' || deleted === '-';
    candidate.additions = candidate.binary ? 0 : Number.parseInt(added, 10) || 0;
    candidate.deletions = candidate.binary ? 0 : Number.parseInt(deleted, 10) || 0;
  }
}

async function hashFile(absolutePath: string): Promise<string> {
  const info = await lstat(absolutePath);
  if (info.isSymbolicLink()) return sha256('symlink', await readlink(absolutePath));
  if (!info.isFile()) return sha256('non-file', info.mode.toString());
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(absolutePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function hashUntracked(worktreePath: string, files: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    hash.update(file);
    hash.update('\0');
    try {
      hash.update(await hashFile(path.join(worktreePath, file)));
    } catch (error) {
      hash.update(`unreadable:${error instanceof Error ? error.message : String(error)}`);
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function untrackedDiff(worktreePath: string, files: readonly string[]): Promise<string> {
  const sections: string[] = [];
  for (const file of files) {
    const absolute = path.join(worktreePath, file);
    try {
      const info = await stat(absolute);
      if (!info.isFile() || info.size > 250_000) {
        sections.push(`diff --git a/${file} b/${file}\nnew untracked file (${info.size} bytes)\n`);
        continue;
      }
      const content = await readFile(absolute, 'utf8');
      if (content.includes('\0')) {
        sections.push(`diff --git a/${file} b/${file}\nnew binary untracked file\n`);
        continue;
      }
      const lines = content.split('\n');
      sections.push([
        `diff --git a/${file} b/${file}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${file}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((line) => `+${line}`),
        '',
      ].join('\n'));
    } catch (error) {
      sections.push(`diff --git a/${file} b/${file}\nunreadable: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return sections.join('\n');
}

async function latestChangedAt(worktreePath: string, files: readonly ChangeFile[], headIso: string): Promise<string> {
  let latest = Date.parse(headIso) || Date.now();
  await Promise.all(files.map(async (file) => {
    try {
      const info = await stat(path.join(worktreePath, file.path));
      latest = Math.max(latest, info.mtimeMs);
    } catch {
      // Deleted paths use the commit timestamp.
    }
  }));
  return new Date(latest).toISOString();
}

export class GitCliRepositoryAdapter implements RepositoryAdapter {
  private readonly diffCache = new Map<string, string>();

  async resolveIdentity(inputPath: string, requestedBaseRef?: string): Promise<RepositoryIdentity> {
    const worktreePath = path.resolve(inputPath);
    const repositoryRoot = path.resolve(await gitText(worktreePath, ['rev-parse', '--show-toplevel']));
    const commonDirRaw = await gitText(worktreePath, ['rev-parse', '--git-common-dir']);
    const commonDir = path.resolve(worktreePath, commonDirRaw);
    const branch = (await gitText(worktreePath, ['branch', '--show-current'])) || '(detached)';
    const headCommit = await gitText(worktreePath, ['rev-parse', 'HEAD']);
    const baseRef = requestedBaseRef || await this.detectBaseRef(worktreePath);
    return {
      repositoryId: sha256(commonDir.toLowerCase()).slice(0, 24),
      repositoryRoot,
      worktreePath: repositoryRoot,
      branch,
      headCommit,
      baseRef,
    };
  }

  async detectBaseRef(worktreePath: string): Promise<string> {
    const remoteHead = await gitText(worktreePath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], true);
    for (const candidate of [remoteHead, 'main', 'master'].filter(Boolean)) {
      const verified = await gitText(worktreePath, ['rev-parse', '--verify', '--quiet', candidate], true);
      if (verified) return candidate;
    }
    const parent = await gitText(worktreePath, ['rev-parse', '--verify', '--quiet', 'HEAD^'], true);
    return parent ? 'HEAD^' : 'HEAD';
  }

  getCachedDiff(workUnitId: string): string | undefined {
    return this.diffCache.get(workUnitId);
  }

  forgetCachedDiff(workUnitId: string): void {
    this.diffCache.delete(workUnitId);
  }

  async inspect(workUnit: WorkUnit, reviewedFiles: ReadonlySet<string>): Promise<RepositoryInspection> {
    const cwd = workUnit.worktreePath;
    const identity = await this.resolveIdentity(cwd, workUnit.baseRef);
    const baseCommit = await gitText(cwd, ['rev-parse', '--verify', '--quiet', workUnit.baseRef], true);
    const diffBase = baseCommit ? workUnit.baseRef : 'HEAD';
    const mergeBase = baseCommit ? await gitText(cwd, ['merge-base', 'HEAD', workUnit.baseRef], true) : '';
    const comparison = mergeBase || diffBase;

    const [statusRaw, nameStatusRaw, numStatRaw, trackedDiff, untrackedRaw, countsRaw, headIso] = await Promise.all([
      gitText(cwd, ['status', '--porcelain=v2', '-z']),
      gitText(cwd, ['diff', '--name-status', '-z', '-M', comparison]),
      gitText(cwd, ['diff', '--numstat', '-M', comparison]),
      gitText(cwd, ['diff', '--binary', '--find-renames', '--no-color', comparison]),
      gitText(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
      baseCommit ? gitText(cwd, ['rev-list', '--left-right', '--count', `${workUnit.baseRef}...HEAD`], true) : Promise.resolve('0\t0'),
      gitText(cwd, ['show', '-s', '--format=%cI', 'HEAD']),
    ]);

    const files = parseNameStatus(nameStatusRaw);
    addNumStats(files, numStatRaw);
    const untracked = untrackedRaw.split('\0').filter(Boolean).map(normalizeGitPath);
    for (const filePath of untracked) {
      if (!files.some((file) => file.path === filePath)) {
        files.push({ path: filePath, status: 'untracked', additions: 0, deletions: 0, binary: false, reviewed: false });
      }
    }
    for (const file of files) file.reviewed = reviewedFiles.has(file.path);

    const [behindRaw = '0', aheadRaw = '0'] = countsRaw.split(/\s+/);
    const ahead = Number.parseInt(aheadRaw, 10) || 0;
    const behind = Number.parseInt(behindRaw, 10) || 0;
    const untrackedContentHash = await hashUntracked(cwd, untracked);
    const trackedDiffHash = sha256(trackedDiff);
    const fingerprint = sha256(baseCommit || 'missing-base', identity.headCommit, trackedDiffHash, untrackedContentHash);
    const fullDiff = `${trackedDiff}${trackedDiff && untracked.length ? '\n' : ''}${await untrackedDiff(cwd, untracked)}`;
    this.diffCache.set(workUnit.id, fullDiff);

    let mergeConflict: boolean | null = null;
    if (baseCommit && statusRaw.length === 0 && ahead > 0) {
      const mergeTree = await runGit(cwd, ['merge-tree', '--write-tree', workUnit.baseRef, 'HEAD']);
      mergeConflict = mergeTree.exitCode === 1 ? true : mergeTree.exitCode === 0 ? false : null;
    }

    const additions = files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
    const topLevelAreas = [...new Set(files.map((file) => file.path.split('/')[0] ?? file.path))].sort();

    return {
      repositoryId: identity.repositoryId,
      repositoryRoot: identity.repositoryRoot,
      branch: identity.branch,
      unifiedDiff: fullDiff,
      mergeConflict,
      change: {
        ...(baseCommit ? { baseCommit: mergeBase || baseCommit } : {}),
        headCommit: identity.headCommit,
        branch: identity.branch,
        dirty: statusRaw.length > 0,
        ahead,
        behind,
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
        additions,
        deletions,
        topLevelAreas,
        trackedDiffHash,
        untrackedContentHash,
        fingerprint,
        lastChangedAt: await latestChangedAt(cwd, files, headIso),
      },
    };
  }
}
