import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GateDefinitionInput, ReviewedFilesInput, WorkUnitRegistration } from '@review-workspace/schema';
import type { WorkspaceService } from './workspace-service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDirectory = path.resolve(here, 'assets');

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function noContent(response: ServerResponse): void {
  response.writeHead(204);
  response.end();
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

async function serveFile(response: ServerResponse, requestedPath: string): Promise<boolean> {
  const root = path.resolve(assetsDirectory, 'web');
  const relative = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
  let filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root)) return false;
  try {
    let info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
    info = await stat(filePath);
    response.writeHead(200, { 'content-type': contentType(filePath), 'content-length': info.size, 'cache-control': relative === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    createReadStream(filePath).pipe(response);
    return true;
  } catch {
    try {
      filePath = path.join(root, 'index.html');
      const info = await stat(filePath);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': info.size, 'cache-control': 'no-cache' });
      createReadStream(filePath).pipe(response);
      return true;
    } catch {
      return false;
    }
  }
}

function localCors(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'origin');
    response.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type');
  }
}

export interface ReviewServer {
  close(): Promise<void>;
  url: string;
}

export async function startServer(service: WorkspaceService, host: string, port: number): Promise<ReviewServer> {
  const server = createServer(async (request, response) => {
    localCors(request, response);
    if (request.method === 'OPTIONS') return noContent(response);
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);
    const pathname = url.pathname;

    try {
      if (request.method === 'GET' && pathname === '/api/v1/workspace') return json(response, 200, service.current());
      if (request.method === 'GET' && pathname === '/api/v1/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        response.write(`event: workspace.snapshot\nid: ${service.current().seq}\ndata: ${JSON.stringify({ type: 'workspace.snapshot', seq: service.current().seq, snapshot: service.current() })}\n\n`);
        const unsubscribe = service.subscribe((event) => response.write(`event: ${event.type}\nid: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`));
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20_000);
        heartbeat.unref();
        request.once('close', () => { clearInterval(heartbeat); unsubscribe(); });
        return;
      }
      if (request.method === 'POST' && pathname === '/api/v1/work-units') {
        const unit = await service.register(await readJson<WorkUnitRegistration>(request));
        return json(response, 201, unit);
      }
      if (request.method === 'GET' && pathname === '/api/v1/work-units/archived') {
        return json(response, 200, await service.archived());
      }
      if (request.method === 'GET' && pathname === '/api/v1/work-units/archived') return json(response, 200, await service.archived());
      if (request.method === 'POST' && pathname === '/api/v1/work-units/archive') {
        const input = await readJson<{ ids?: string[] }>(request);
        const ids = (input.ids ?? []).filter((id): id is string => typeof id === 'string');
        if (ids.length === 0) throw new Error('Bulk archive requires at least one work-unit id.');
        const archived = await service.archiveMany(ids);
        return json(response, 200, { archived });
      }
      const archiveMatch = pathname.match(/^\/api\/v1\/work-units\/([^/]+)\/archive$/);
      if (request.method === 'POST' && archiveMatch) {
        const unit = await service.archive(decodeURIComponent(archiveMatch[1] ?? ''));
        return unit ? json(response, 200, unit) : json(response, 404, { error: 'Work unit not found or already archived.' });
      }
      const unarchiveMatch = pathname.match(/^\/api\/v1\/work-units\/([^/]+)\/unarchive$/);
      if (request.method === 'POST' && unarchiveMatch) {
        const unit = await service.unarchive(decodeURIComponent(unarchiveMatch[1] ?? ''));
        return unit ? json(response, 200, unit) : json(response, 404, { error: 'Work unit not found.' });
      }

      const workUnitMatch = pathname.match(/^\/api\/v1\/work-units\/([^/]+)$/);
      if (request.method === 'DELETE' && workUnitMatch) {
        const removed = await service.unregister(decodeURIComponent(workUnitMatch[1] ?? ''));
        return removed ? noContent(response) : json(response, 404, { error: 'Work unit not found.' });
      }
      const diffMatch = pathname.match(/^\/api\/v1\/work-units\/([^/]+)\/diff$/);
      if (request.method === 'GET' && diffMatch) {
        const id = decodeURIComponent(diffMatch[1] ?? '');
        const file = url.searchParams.get('file');
        if (file !== null) {
          const fileDiff = await service.fileDiff(id, file);
          if (fileDiff === null) return json(response, 404, { error: 'File not in the change set.' });
          response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
          return response.end(fileDiff);
        }
        const diff = await service.diff(id);
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
        return response.end(diff);
      }
      const gatesMatch = pathname.match(/^\/api\/v1\/work-units\/([^/]+)\/gates$/);
      if (request.method === 'POST' && gatesMatch) {
        const gate = await service.addGate(decodeURIComponent(gatesMatch[1] ?? ''), await readJson<GateDefinitionInput>(request));
        return json(response, 201, gate);
      }
      const runGateMatch = pathname.match(/^\/api\/v1\/work-units\/([^/]+)\/gates\/([^/]+)\/run$/);
      if (request.method === 'POST' && runGateMatch) {
        const input = await readJson<{ force?: boolean }>(request);
        const run = await service.runGate(decodeURIComponent(runGateMatch[1] ?? ''), decodeURIComponent(runGateMatch[2] ?? ''), input.force ?? true);
        return json(response, 200, run);
      }
      const gateMatch = pathname.match(/^\/api\/v1\/work-units\/([^/]+)\/gates\/([^/]+)$/);
      if (request.method === 'DELETE' && gateMatch) {
        const removed = await service.removeGate(decodeURIComponent(gateMatch[1] ?? ''), decodeURIComponent(gateMatch[2] ?? ''));
        return removed ? noContent(response) : json(response, 404, { error: 'Trusted gate not found.' });
      }
      const reviewedMatch = pathname.match(/^\/api\/v1\/work-units\/([^/]+)\/reviewed$/);
      if (request.method === 'POST' && reviewedMatch) {
        await service.setReviewed(decodeURIComponent(reviewedMatch[1] ?? ''), await readJson<ReviewedFilesInput>(request));
        return json(response, 200, service.current());
      }
      if (request.method === 'GET' && pathname === '/workspace.schema.json') {
        const schema = await readFile(path.join(assetsDirectory, 'workspace.schema.json'));
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': schema.length });
        return response.end(schema);
      }
      if (request.method === 'GET' && pathname === '/openapi.json') {
        const openapi = await readFile(path.join(assetsDirectory, 'openapi.json'));
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': openapi.length });
        return response.end(openapi);
      }
      if (request.method === 'GET' && await serveFile(response, pathname)) return;
      json(response, 404, { error: 'Not found.' });
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;
  return {
    url: `http://${host}:${boundPort}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
