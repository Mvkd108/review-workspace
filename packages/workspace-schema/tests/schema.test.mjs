import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('published JSON schema and OpenAPI share the package version', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema/workspace.schema.json', import.meta.url)));
  const openapi = JSON.parse(await readFile(new URL('../openapi.json', import.meta.url)));
  assert.equal(schema.properties.schemaVersion.const, '0.3.0-beta.1');
  assert.equal(openapi.info.version, '0.3.0-beta.1');
});

test('work-unit lifecycle and visibility states are explicit and separate', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema/workspace.schema.json', import.meta.url)));
  const unit = schema.$defs.workUnit;
  assert.deepEqual(unit.properties.lifecycle.enum, ['observing', 'unavailable']);
  assert.deepEqual(unit.properties.visibility.enum, ['active', 'archived']);
  assert.ok(unit.required.includes('visibility'));
  assert.ok(!unit.required.includes('ready-for-review'));
});

test('OpenAPI covers the archive, unarchive, and bulk archive operations', async () => {
  const openapi = JSON.parse(await readFile(new URL('../openapi.json', import.meta.url)));
  assert.equal(openapi.paths['/work-units/{id}/archive'].post.summary.includes('Archive'), true);
  assert.equal(openapi.paths['/work-units/{id}/unarchive'].post.summary.includes('Restore'), true);
  assert.equal(openapi.paths['/work-units/archive'].post.summary.includes('multiple'), true);
});
