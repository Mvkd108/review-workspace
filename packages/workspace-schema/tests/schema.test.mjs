import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('published JSON schema and OpenAPI share the package version', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema/workspace.schema.json', import.meta.url)));
  const openapi = JSON.parse(await readFile(new URL('../openapi.json', import.meta.url)));
  assert.equal(schema.properties.schemaVersion.const, '0.4.0-beta.0');
  assert.equal(openapi.info.version, '0.4.0-beta.0');
});

// The launch contract forbids releasing with the schema, the OpenAPI document,
// and the schema version out of step. The npm version is what a consumer pins,
// so it has to say the same thing as the payload it ships; publishing 0.2.0 with
// a 0.4.0-beta.0 body would misdescribe the contract to anyone installing it.
test('the npm package version matches the schema version it ships', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const declared = source.match(/WORKSPACE_SCHEMA_VERSION = '([^']+)'/)?.[1];
  assert.equal(declared, manifest.version);
});

test('snapshot exposes inspecting/fresh/stale status as an optional additive surface', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema/workspace.schema.json', import.meta.url)));
  assert.deepEqual(schema.properties.status.enum, ['fresh', 'inspecting', 'stale']);
  assert.equal(typeof schema.properties.inspectedAt.format, 'string');
  assert.equal(typeof schema.properties.staleReason.type, 'string');
  assert.ok(!schema.required.includes('status'), 'status stays optional so consumers predating it keep typechecking');
});

test('work-unit lifecycle and visibility states are explicit and separate', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema/workspace.schema.json', import.meta.url)));
  const unit = schema.$defs.workUnit;
  assert.deepEqual(unit.properties.lifecycle.enum, ['observing', 'unavailable']);
  assert.deepEqual(unit.properties.visibility.enum, ['active', 'archived']);
  assert.ok(unit.required.includes('visibility'));
  assert.ok(!unit.required.includes('ready-for-review'));
});

test('agent sessions expose no transcript content, tool output, or raw transcript path', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema/workspace.schema.json', import.meta.url)));
  const session = schema.$defs.agentSession;
  assert.ok(!session.required.includes('sourcePath'), 'the raw transcript path is not part of the public contract');
  assert.ok(!('sourcePath' in session.properties), 'sourcePath must not be described in the schema');
  assert.deepEqual(Object.keys(session.properties).sort(), ['agentLabel', 'cwd', 'lastActivityAt', 'lastTurnComplete', 'sessionId', 'state']);
  for (const key of ['content', 'message', 'output', 'payload', 'tool_use']) {
    assert.ok(!(key in session.properties), `transcript payload key ${key} must not appear on AgentSession`);
  }
});

test('OpenAPI covers the archive, unarchive, and bulk archive operations', async () => {
  const openapi = JSON.parse(await readFile(new URL('../openapi.json', import.meta.url)));
  assert.equal(openapi.paths['/work-units/{id}/archive'].post.summary.includes('Archive'), true);
  assert.equal(openapi.paths['/work-units/{id}/unarchive'].post.summary.includes('Restore'), true);
  assert.equal(openapi.paths['/work-units/archive'].post.summary.includes('multiple'), true);
});
