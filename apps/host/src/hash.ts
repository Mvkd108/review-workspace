import { createHash } from 'node:crypto';

export function sha256(...values: readonly (string | Buffer)[]): string {
  const hash = createHash('sha256');
  for (const value of values) {
    hash.update(value);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
