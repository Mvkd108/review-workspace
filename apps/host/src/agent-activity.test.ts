import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentSession } from '@review-workspace/schema';
import { AgentActivityObserver, isWithin, summarize } from './agent-activity.js';

const temporary: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

async function sources(): Promise<{ claudeCodeProjects: string; codexSessions: string; root: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-workspace-agents-'));
  temporary.push(root);
  const claudeCodeProjects = path.join(root, 'claude', 'projects');
  const codexSessions = path.join(root, 'codex', 'sessions');
  await mkdir(path.join(claudeCodeProjects, 'project'), { recursive: true });
  await mkdir(path.join(codexSessions, '2026', '08', '20'), { recursive: true });
  return { claudeCodeProjects, codexSessions, root };
}

const jsonl = (entries: unknown[]): string => entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';

async function writeTranscript(filePath: string, entries: unknown[], ageMs = 0): Promise<void> {
  await writeFile(filePath, jsonl(entries));
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    await utimes(filePath, when, when);
  }
}

const codexTurn = (cwd: string, complete: boolean) => [
  { type: 'session_meta', payload: { session_id: 'abc', cwd } },
  { type: 'event_msg', payload: { type: 'task_started' } },
  { type: 'response_item', payload: { type: 'function_call' } },
  ...(complete ? [{ type: 'event_msg', payload: { type: 'task_complete' } }] : []),
];

const claudeCodeTurn = (cwd: string, complete: boolean) => [
  { type: 'user', cwd, message: { role: 'user', content: 'do the thing' } },
  { type: 'assistant', cwd, message: { role: 'assistant', stop_reason: complete ? 'end_turn' : 'tool_use' } },
];

describe('Agent activity observation', () => {
  it('reads an open Codex turn as working and a finished one as idle', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const day = path.join(codexSessions, '2026', '08', '20');
    await writeTranscript(path.join(day, 'rollout-open.jsonl'), codexTurn('C:/work/alpha', false));
    await writeTranscript(path.join(day, 'rollout-done.jsonl'), codexTurn('C:/work/beta', true));

    const sessions = await new AgentActivityObserver({ claudeCodeProjects, codexSessions }).collect();
    const byCwd = new Map(sessions.map((session) => [path.resolve(session.cwd), session]));

    expect(byCwd.get(path.resolve('C:/work/alpha'))?.state).toBe('working');
    expect(byCwd.get(path.resolve('C:/work/alpha'))?.lastTurnComplete).toBe(false);
    expect(byCwd.get(path.resolve('C:/work/beta'))?.state).toBe('idle');
  });

  it('reads a trailing Claude Code tool call as an open turn', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const project = path.join(claudeCodeProjects, 'project');
    await writeTranscript(path.join(project, 'open.jsonl'), claudeCodeTurn('C:/work/gamma', false));
    await writeTranscript(path.join(project, 'done.jsonl'), claudeCodeTurn('C:/work/delta', true));

    const sessions = await new AgentActivityObserver({ claudeCodeProjects, codexSessions }).collect();
    const byCwd = new Map(sessions.map((session) => [path.resolve(session.cwd), session]));

    expect(byCwd.get(path.resolve('C:/work/gamma'))?.state).toBe('working');
    expect(byCwd.get(path.resolve('C:/work/delta'))?.state).toBe('idle');
    expect(byCwd.get(path.resolve('C:/work/gamma'))?.agentLabel).toBe('claude-code');
  });

  it('reports an open turn that stopped writing as stalled rather than working', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const day = path.join(codexSessions, '2026', '08', '20');
    await writeTranscript(path.join(day, 'rollout-stalled.jsonl'), codexTurn('C:/work/epsilon', false), 10 * 60_000);

    const [session] = await new AgentActivityObserver({ claudeCodeProjects, codexSessions }).collect();
    expect(session?.state).toBe('stalled');
    expect(session?.lastTurnComplete).toBe(false);
  });

  it('ignores transcripts older than the discovery window', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const day = path.join(codexSessions, '2026', '08', '20');
    await writeTranscript(path.join(day, 'rollout-ancient.jsonl'), codexTurn('C:/work/zeta', true), 48 * 60 * 60_000);

    expect(await new AgentActivityObserver({ claudeCodeProjects, codexSessions }).collect()).toEqual([]);
  });

  it('does not treat a sibling directory sharing a name prefix as contained', () => {
    expect(isWithin('C:/projects/muesli', 'C:/projects/muesli')).toBe(true);
    expect(isWithin('C:/projects/muesli', 'C:/projects/muesli/src/app')).toBe(true);
    expect(isWithin('C:/projects/muesli', 'C:/projects/muesli-wt-a-l10')).toBe(false);
  });

  it('binds a session to the most specific worktree containing its directory', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const observer = new AgentActivityObserver({ claudeCodeProjects, codexSessions });
    const session = (cwd: string): AgentSession => ({
      sessionId: cwd, agentLabel: 'codex', cwd, sourcePath: `${cwd}.jsonl`,
      state: 'idle', lastActivityAt: new Date().toISOString(), lastTurnComplete: true,
    });

    const indexed = observer.index(
      [session(path.resolve('C:/repo/packages/api/src')), session(path.resolve('C:/repo/docs'))],
      [path.resolve('C:/repo'), path.resolve('C:/repo/packages/api')],
    );

    expect(indexed.get(path.resolve('C:/repo/packages/api'))).toHaveLength(1);
    expect(indexed.get(path.resolve('C:/repo'))).toHaveLength(1);
  });

  it('summarizes a worktree by its most active session', () => {
    const base = { agentLabel: 'codex' as const, cwd: 'C:/work', sourcePath: 'a.jsonl', lastTurnComplete: true };
    const older = { ...base, sessionId: 'older', state: 'idle' as const, lastActivityAt: '2026-08-20T10:00:00.000Z' };
    const newer = { ...base, sessionId: 'newer', state: 'working' as const, lastTurnComplete: false, lastActivityAt: '2026-08-20T12:00:00.000Z' };

    const summary = summarize([older, newer]);
    expect(summary.state).toBe('working');
    expect(summary.lastActivityAt).toBe('2026-08-20T12:00:00.000Z');
    expect(summary.sessions[0]?.sessionId).toBe('newer');
    expect(summarize([]).state).toBe('unknown');
  });
});
