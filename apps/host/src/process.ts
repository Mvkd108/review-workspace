import { spawn } from 'node:child_process';

export interface ProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export function runProcess(program: string, args: readonly string[], options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const limit = options.maxOutputBytes ?? 2_000_000;
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(program, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: options.signal,
    });

    const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> => {
      if (current.length >= limit) {
        truncated = true;
        return current;
      }
      const remaining = limit - current.length;
      if (chunk.length > remaining) truncated = true;
      return Buffer.concat([current, chunk.subarray(0, remaining)]);
    };

    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
        }, options.timeoutMs)
      : undefined;
    timeout?.unref();

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        exitCode: code ?? (timedOut ? 124 : 1),
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        durationMs: Date.now() - started,
        timedOut,
        truncated,
      });
    });
  });
}

export async function runGit(cwd: string, args: readonly string[], timeoutMs = 30_000): Promise<ProcessResult> {
  return runProcess('git', ['-c', `safe.directory=${cwd}`, ...args], { cwd, timeoutMs, maxOutputBytes: 8_000_000 });
}
