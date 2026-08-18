import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const host = path.resolve(here, '..');
const root = path.resolve(host, '../..');
const assets = path.join(host, 'dist', 'assets');
await mkdir(assets, { recursive: true });
await cp(path.join(root, 'apps', 'web', 'dist'), path.join(assets, 'web'), { recursive: true, force: true });
await cp(path.join(root, 'packages', 'workspace-schema', 'schema', 'workspace.schema.json'), path.join(assets, 'workspace.schema.json'), { force: true });
await cp(path.join(root, 'packages', 'workspace-schema', 'openapi.json'), path.join(assets, 'openapi.json'), { force: true });
