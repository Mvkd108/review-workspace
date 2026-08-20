import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('published JSON schema and OpenAPI share the package version', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema/workspace.schema.json', import.meta.url)));
  const openapi = JSON.parse(await readFile(new URL('../openapi.json', import.meta.url)));
  assert.equal(schema.properties.schemaVersion.const, '0.2.0');
  assert.equal(openapi.info.version, '0.2.0');
});
