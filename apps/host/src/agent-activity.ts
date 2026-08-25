import { open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentActivity, AgentActivityState, AgentLabel, AgentSession } from '@review-workspace/schema';
import { isWithinPath } from './paths.js';

/**
 * Observes agent-owned transcript files to answer one question the repo channel
 * cannot: is an agent still producing output in this worktree, or has it stopped?
 *
 * This channel reads only. It never launches, steers, or cancels an agent, and a
 * transcript is treated as a report rather than an authority: Git remains the
 * source of truth for what actually changed. Activity is advisory and never
 * affects merge readiness.
 *
 * Privacy boundary: only the working directory and turn-boundary markers are
 * read. Message content and tool output are never copied into sessions, so they
 * can never reach a snapshot or the API. The transcript path is used for
 * discovery, caching, and binding, but is not part of the public AgentSession.
 */

/**
 * A transcript written more recently than this is an agent still producing output.
 * Do not tune this threshold without usage evidence: `stalled` is deliberately
 * conservative so a long tool call is reported rather than missed.
 */
const WORKING_WINDOW_MS = 180_000;
/** Transcripts untouched for longer than this are too old to be worth reading. */
const DISCOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Only the end of a transcript is needed to find the most recent turn boundary. */
const TAIL_BYTES = 256 * 1024;
/** Used only when the tail carries no working directory of its own. */
const HEAD_BYTES = 64 * 1024;

export interface AgentActivitySources {
  claudeCodeProjects: string;
  codexSessions: string;
}

export function defaultActivitySources(home = os.homedir()): AgentActivitySources {
  return {
    claudeCodeProjects: path.join(home, '.claude', 'projects'),
    codexSessions: path.join(home, '.codex', 'sessions'),
  };
}

interface DiscoveredTranscript {
  filePath: string;
  agentLabel: AgentLabel;
  modifiedAt: Date;
}

async function readSlice(filePath: string, bytes: number, fromEnd: boolean): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(bytes, size);
    const position = fromEnd ? size - length : 0;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, position);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Parses JSONL, dropping the leading fragment when a slice starts mid-line. */
function parseLines(text: string, droppedLeadingFragment: boolean): Record<string, unknown>[] {
  const lines = text.split('\n');
  if (droppedLeadingFragment && lines.length > 1) lines.shift();
  const parsed: Record<string, unknown>[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (value && typeof value === 'object') parsed.push(value as Record<string, unknown>);
    } catch {
      // Truncated or partially flushed lines are expected while an agent is writing.
    }
  }
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function findCwd(entries: readonly Record<string, unknown>[]): string | undefined {
  for (const entry of entries) {
    if (typeof entry.cwd === 'string' && entry.cwd.trim()) return entry.cwd;
    const payload = asRecord(entry.payload);
    if (payload && typeof payload.cwd === 'string' && payload.cwd.trim()) return payload.cwd;
  }
  return undefined;
}

/**
 * Codex brackets each turn with `task_started` and `task_complete` event messages.
 * Scanning backwards finds the most recent boundary without reading the whole file.
 */
function codexTurnComplete(entries: readonly Record<string, unknown>[]): boolean | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const payloadType = asRecord(entries[index]?.payload)?.type;
    if (payloadType === 'task_complete' || payloadType === 'turn_aborted') return true;
    if (payloadType === 'task_started') return false;
  }
  return undefined;
}

/**
 * Claude Code closes a turn with an assistant message whose stop reason ends it.
 * A trailing tool call, or a user message with no reply yet, means the turn is open.
 */
function claudeCodeTurnComplete(entries: readonly Record<string, unknown>[]): boolean | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.type === 'assistant') {
      const stopReason = asRecord(entry.message)?.stop_reason;
      if (stopReason === 'end_turn' || stopReason === 'stop_sequence') return true;
      if (typeof stopReason === 'string') return false;
      continue;
    }
    if (entry.type === 'user') return false;
  }
  return undefined;
}

function deriveState(lastTurnComplete: boolean, modifiedAt: Date, now: number): AgentActivityState {
  if (lastTurnComplete) return 'idle';
  return now - modifiedAt.getTime() <= WORKING_WINDOW_MS ? 'working' : 'stalled';
}

async function discoverClaudeCode(root: string, since: number): Promise<DiscoveredTranscript[]> {
  const found: DiscoveredTranscript[] = [];
  let projectDirs: string[];
  try {
    projectDirs = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return found;
  }
  for (const dir of projectDirs) {
    const projectPath = path.join(root, dir);
    let files: string[];
    try {
      files = (await readdir(projectPath)).filter((name) => name.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const name of files) {
      const filePath = path.join(projectPath, name);
      try {
        const info = await stat(filePath);
        if (info.mtimeMs >= since) found.push({ filePath, agentLabel: 'claude-code', modifiedAt: info.mtime });
      } catch {
        // A session file can vanish between listing and stat.
      }
    }
  }
  return found;
}

/** Codex nests rollouts as sessions/YYYY/MM/DD/rollout-*.jsonl. */
async function discoverCodex(root: string, since: number): Promise<DiscoveredTranscript[]> {
  const found: DiscoveredTranscript[] = [];

  const walk = async (directory: string, depth: number): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth < 3) await walk(entryPath, depth + 1);
        continue;
      }
      if (!entry.name.endsWith('.jsonl')) continue;
      try {
        const info = await stat(entryPath);
        if (info.mtimeMs >= since) found.push({ filePath: entryPath, agentLabel: 'codex', modifiedAt: info.mtime });
      } catch {
        // Ignore files that disappear mid-scan.
      }
    }
  };

  await walk(root, 0);
  return found;
}

/**
 * Reduces a transcript tail to the public session record. Returns undefined for
 * transcripts the reader cannot make sense of, so a changed or unknown format
 * degrades to no signal rather than a guess. Only the cwd and turn boundary are
 * extracted; message content and tool output never leave this function.
 */
async function readSession(transcript: DiscoveredTranscript, now: number): Promise<AgentSession | undefined> {
  let tail: string;
  try {
    tail = await readSlice(transcript.filePath, TAIL_BYTES, true);
  } catch {
    return undefined;
  }
  const entries = parseLines(tail, tail.length >= TAIL_BYTES);
  if (entries.length === 0) return undefined;

  const turnComplete =
    transcript.agentLabel === 'codex' ? codexTurnComplete(entries) : claudeCodeTurnComplete(entries);
  if (turnComplete === undefined) return undefined;

  let cwd = findCwd(entries);
  if (!cwd) {
    try {
      cwd = findCwd(parseLines(await readSlice(transcript.filePath, HEAD_BYTES, false), false));
    } catch {
      cwd = undefined;
    }
  }
  if (!cwd) return undefined;

  return {
    sessionId: path.basename(transcript.filePath, '.jsonl'),
    agentLabel: transcript.agentLabel,
    cwd: path.resolve(cwd),
    state: deriveState(turnComplete, transcript.modifiedAt, now),
    lastActivityAt: transcript.modifiedAt.toISOString(),
    lastTurnComplete: turnComplete,
  };
}

/**
 * True when `candidate` is the directory itself or lives inside it, by path
 * segment. Canonicalised first so a session whose reported working directory is
 * spelled differently from the registration — a Windows 8.3 alias, or a symlink
 * — still binds to its worktree.
 */
export function isWithin(parent: string, candidate: string): boolean {
  return isWithinPath(candidate, parent);
}

const STATE_PRIORITY: readonly AgentActivityState[] = ['working', 'stalled', 'idle', 'unknown'];

export function summarize(sessions: readonly AgentSession[]): AgentActivity {
  if (sessions.length === 0) return { state: 'unknown', sessions: [] };
  const ordered = [...sessions].sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
  const state = STATE_PRIORITY.find((candidate) => ordered.some((session) => session.state === candidate)) ?? 'unknown';
  const lastActivityAt = ordered[0]?.lastActivityAt;
  return { state, ...(lastActivityAt ? { lastActivityAt } : {}), sessions: ordered };
}

/**
 * Reads every recent transcript once, then indexes sessions by worktree so a
 * refresh costs one scan regardless of how many work units are registered.
 *
 * Cursor is deliberately absent: it stores chat in a VS Code SQLite database
 * rather than transcript files, so it cannot be observed the same way.
 */
export class AgentActivityObserver {
  /** Parsed transcripts keyed by path, reused until the file's mtime moves. */
  private readonly cache = new Map<string, { mtimeMs: number; session: AgentSession }>();

  constructor(private readonly sources: AgentActivitySources = defaultActivitySources()) {}

  watchPaths(): string[] {
    return [this.sources.claudeCodeProjects, this.sources.codexSessions];
  }

  async collect(now = Date.now()): Promise<AgentSession[]> {
    const since = now - DISCOVERY_WINDOW_MS;
    const [claudeCode, codex] = await Promise.all([
      discoverClaudeCode(this.sources.claudeCodeProjects, since),
      discoverCodex(this.sources.codexSessions, since),
    ]);
    const transcripts = [...claudeCode, ...codex];

    const sessions = await Promise.all(
      transcripts.map(async (transcript) => {
        const cached = this.cache.get(transcript.filePath);
        // Re-derive state on every pass: `working` decays to `stalled` with time alone.
        if (cached && cached.mtimeMs === transcript.modifiedAt.getTime()) {
          return { ...cached.session, state: deriveState(cached.session.lastTurnComplete, transcript.modifiedAt, now) };
        }
        const session = await readSession(transcript, now);
        if (session) this.cache.set(transcript.filePath, { mtimeMs: transcript.modifiedAt.getTime(), session });
        return session;
      }),
    );

    const live = new Set(transcripts.map((transcript) => transcript.filePath));
    for (const key of this.cache.keys()) if (!live.has(key)) this.cache.delete(key);

    return sessions.filter((session): session is AgentSession => session !== undefined);
  }

  /** Groups sessions under the most specific worktree that contains their cwd. */
  index(sessions: readonly AgentSession[], worktreePaths: readonly string[]): Map<string, AgentSession[]> {
    const byWorktree = new Map<string, AgentSession[]>();
    for (const worktreePath of worktreePaths) byWorktree.set(worktreePath, []);
    for (const session of sessions) {
      let best: string | undefined;
      for (const worktreePath of worktreePaths) {
        if (!isWithin(worktreePath, session.cwd)) continue;
        if (!best || worktreePath.length > best.length) best = worktreePath;
      }
      if (best) byWorktree.get(best)?.push(session);
    }
    return byWorktree;
  }
}
