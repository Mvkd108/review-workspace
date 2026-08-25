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

// --- Codex JSONL fixture shapes -------------------------------------------------

const codexSessionMeta = (cwd: string) => ({ type: 'session_meta', payload: { session_id: 'sess-abc', cwd } });
const codexTurnStart = { type: 'event_msg', payload: { type: 'task_started', timestamp: '2026-08-20T12:00:00.000Z' } };
const codexTurnComplete = { type: 'event_msg', payload: { type: 'task_complete', timestamp: '2026-08-20T12:05:00.000Z' } };
const codexTurnAborted = { type: 'event_msg', payload: { type: 'turn_aborted', timestamp: '2026-08-20T12:02:00.000Z' } };
const codexMessage = (text: string) => ({
  type: 'response_item', payload: { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text }] } },
});
const codexFunctionCall = { type: 'response_item', payload: { type: 'function_call', name: 'Read', arguments: '{"path":"src/api/client.ts"}' } };
const codexFunctionOutput = (output: string) => ({
  type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_1', output },
});

/** A realistic full Codex rollout: header, turn markers, assistant messages, and a tool call with output. */
const codexTurn = (cwd: string, complete: boolean): unknown[] => [
  codexSessionMeta(cwd),
  codexTurnStart,
  codexMessage('I will add retry handling to the API client.'),
  codexFunctionCall,
  codexFunctionOutput('export class ApiClient {\n  async get(url) { return fetch(url); }\n}'),
  codexMessage('Done.'),
  ...(complete ? [codexTurnComplete] : []),
];

// --- Claude Code JSONL fixture shapes ---------------------------------------------

const claudeUser = (cwd: string, text = 'do the thing'): unknown => ({
  parentUuid: 'root', isSidechain: false, userType: 'external', cwd, sessionId: 'sess-xyz', version: '2.1.0',
  type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, uuid: 'u1', timestamp: '2026-08-20T13:00:00.000Z',
});
const claudeAssistant = (cwd: string, content: unknown[], stopReason: string): unknown => ({
  parentUuid: 'u1', isSidechain: false, cwd, sessionId: 'sess-xyz', version: '2.1.0',
  type: 'assistant', message: { role: 'assistant', content, model: 'claude-sonnet-4', stop_reason: stopReason },
  uuid: 'u2', timestamp: '2026-08-20T13:00:05.000Z',
});
const claudeText = (text: string) => ({ type: 'text', text });
const claudeToolUse = (command: string) => ({ type: 'tool_use', name: 'Bash', input: { command }, tool_use_id: 't1' });

/** A realistic Claude Code turn: a user request, a text reply, a Bash tool call, and an optional end_turn. */
const claudeCodeTurn = (cwd: string, complete: boolean): unknown[] => [
  claudeUser(cwd),
  claudeAssistant(cwd, [claudeText('Let me look at the code first.')], 'tool_use'),
  claudeAssistant(cwd, [claudeToolUse('git status')], 'tool_use'),
  ...(complete ? [claudeAssistant(cwd, [claudeText('Done.')], 'end_turn')] : []),
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
    expect(byCwd.get(path.resolve('C:/work/beta'))?.lastTurnComplete).toBe(true);
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

  it('treats an aborted Codex turn as ended rather than open', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const day = path.join(codexSessions, '2026', '08', '20');
    await writeTranscript(path.join(day, 'rollout-aborted.jsonl'), [
      codexSessionMeta('C:/work/aborted'),
      codexTurnStart,
      codexMessage('Started before the abort.'),
      codexTurnAborted,
    ]);

    const [session] = await new AgentActivityObserver({ claudeCodeProjects, codexSessions }).collect();
    expect(session?.state).toBe('idle');
    expect(session?.lastTurnComplete).toBe(true);
  });

  it('reports an open turn that stopped writing as stalled rather than working', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const day = path.join(codexSessions, '2026', '08', '20');
    await writeTranscript(path.join(day, 'rollout-stalled.jsonl'), codexTurn('C:/work/epsilon', false), 10 * 60_000);

    const [session] = await new AgentActivityObserver({ claudeCodeProjects, codexSessions }).collect();
    expect(session?.state).toBe('stalled');
    expect(session?.lastTurnComplete).toBe(false);
  });

  it('keeps the staleness threshold at three minutes of transcript silence', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const day = path.join(codexSessions, '2026', '08', '20');
    await writeTranscript(path.join(day, 'recent.jsonl'), codexTurn('C:/work/fresh', false), 2 * 60_000);
    await writeTranscript(path.join(day, 'silent.jsonl'), codexTurn('C:/work/silent', false), 4 * 60_000);

    const sessions = await new AgentActivityObserver({ claudeCodeProjects, codexSessions }).collect();
    const byCwd = new Map(sessions.map((session) => [path.resolve(session.cwd), session]));

    expect(byCwd.get(path.resolve('C:/work/fresh'))?.state).toBe('working');
    expect(byCwd.get(path.resolve('C:/work/silent'))?.state).toBe('stalled');
  });

  it('ignores transcripts older than the discovery window', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const day = path.join(codexSessions, '2026', '08', '20');
    await writeTranscript(path.join(day, 'rollout-ancient.jsonl'), codexTurn('C:/work/zeta', true), 48 * 60 * 60_000);

    expect(await new AgentActivityObserver({ claudeCodeProjects, codexSessions }).collect()).toEqual([]);
  });

  it('degrades an unrecognized transcript format to no signal', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const day = path.join(codexSessions, '2026', '08', '20');
    await writeTranscript(path.join(day, 'rollout-unknown.jsonl'), [
      { type: 'unknown_record', payload: { foo: 'bar' } },
      { type: 'response_item', payload: { type: 'mystery' } },
    ]);

    expect(await new AgentActivityObserver({ claudeCodeProjects, codexSessions }).collect()).toEqual([]);
  });

  it('degrades a transcript with no recognizable turn boundary to no signal', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const project = path.join(claudeCodeProjects, 'project');
    await writeTranscript(path.join(project, 'summary-only.jsonl'), [
      { type: 'summary', cwd: 'C:/work/zeta', leafUuid: 'u9', summary: 'recent work' },
      { type: 'summary', cwd: 'C:/work/zeta', leafUuid: 'u8', summary: 'more recent work' },
    ]);

    expect(await new AgentActivityObserver({ claudeCodeProjects, codexSessions }).collect()).toEqual([]);
  });

  it('degrades a non-JSON transcript to no signal', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const day = path.join(codexSessions, '2026', '08', '20');
    const filePath = path.join(day, 'rollout-garbage.jsonl');
    await writeFile(filePath, 'this is not jsonl\nneither is this\n');

    expect(await new AgentActivityObserver({ claudeCodeProjects, codexSessions }).collect()).toEqual([]);
  });

  it('keeps reading readable transcripts when a sibling is unrecognizable', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const day = path.join(codexSessions, '2026', '08', '20');
    await writeTranscript(path.join(day, 'rollout-bad.jsonl'), [{ type: 'unknown_record', payload: {} }]);
    await writeTranscript(path.join(day, 'rollout-good.jsonl'), codexTurn('C:/work/iota', true));

    const sessions = await new AgentActivityObserver({ claudeCodeProjects, codexSessions }).collect();
    expect(sessions).toHaveLength(1);
    expect(path.resolve(sessions[0]!.cwd)).toBe(path.resolve('C:/work/iota'));
  });

  it('never copies message content or tool output into a session', async () => {
    const { claudeCodeProjects, codexSessions } = await sources();
    const day = path.join(codexSessions, '2026', '08', '20');
    const contentMarker = 'SECRET_MESSAGE_CONTENT';
    const outputMarker = 'SECRET_TOOL_OUTPUT';
    await writeTranscript(path.join(day, 'rollout-private.jsonl'), [
      codexSessionMeta('C:/work/private'),
      codexTurnStart,
      codexMessage(contentMarker),
      codexFunctionOutput(outputMarker),
      codexTurnComplete,
    ]);

    const [session] = await new AgentActivityObserver({ claudeCodeProjects, codexSessions }).collect();
    expect(session?.state).toBe('idle');
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain(contentMarker);
    expect(serialized).not.toContain(outputMarker);
    expect(Object.keys(session!).sort()).toEqual(['agentLabel', 'cwd', 'lastActivityAt', 'lastTurnComplete', 'sessionId', 'state']);
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
      sessionId: cwd, agentLabel: 'codex', cwd,
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
    const base = { agentLabel: 'codex' as const, cwd: 'C:/work', lastTurnComplete: true };
    const older = { ...base, sessionId: 'older', state: 'idle' as const, lastActivityAt: '2026-08-20T10:00:00.000Z' };
    const newer = { ...base, sessionId: 'newer', state: 'working' as const, lastTurnComplete: false, lastActivityAt: '2026-08-20T12:00:00.000Z' };

    const summary = summarize([older, newer]);
    expect(summary.state).toBe('working');
    expect(summary.lastActivityAt).toBe('2026-08-20T12:00:00.000Z');
    expect(summary.sessions[0]?.sessionId).toBe('newer');
    expect(summarize([]).state).toBe('unknown');
  });
});
