import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Remove the previous build output so stale test artifacts and superseded
// asset bundles never reach the packed package. tsc does not clean outDir.
const host = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
rmSync(path.join(host, 'dist'), { recursive: true, force: true });
