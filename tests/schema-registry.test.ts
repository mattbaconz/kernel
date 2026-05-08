import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  getKernelSchemaPathResult,
  getKernelSchemaShowResult,
  getKernelSchemaVersionsResult,
  KernelSchemaVersionNotFoundError,
  listKernelSchemas
} from '../src/core/schema-registry.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Kernel schema registry', () => {
  test('discovers installed schema versions and names from schema files', async () => {
    const schemaRoot = await createSchemaRoot();
    await writeCompleteSchemaVersion(schemaRoot, 'v1', ['alpha-result']);
    await writeCompleteSchemaVersion(schemaRoot, 'v2', ['future-output', 'adapter-output']);

    expect(getKernelSchemaVersionsResult({ schemaRoot })).toEqual({
      versions: ['v1', 'v2']
    });
    expect(listKernelSchemas(undefined, { schemaRoot }).map((schema) => schema.name)).toEqual([
      'adapter-output',
      'error-envelope',
      'future-output',
      'schema-list-result',
      'schema-path-result',
      'schema-show-result',
      'schema-versions-result'
    ]);
    expect(getKernelSchemaPathResult('future-output', undefined, { schemaRoot })).toEqual({
      version: 'v2',
      path: join(schemaRoot, 'v2', 'future-output.schema.json'),
      schema: {
        version: 'v2',
        name: 'future-output',
        fileName: 'future-output.schema.json',
        path: join(schemaRoot, 'v2', 'future-output.schema.json')
      }
    });
  });

  test('excludes incomplete schema version directories from supported versions', async () => {
    const schemaRoot = await createSchemaRoot();
    await writeCompleteSchemaVersion(schemaRoot, 'v1');
    await mkdir(join(schemaRoot, 'v3'), { recursive: true });
    await writeSchemaFile(schemaRoot, 'v3', 'error-envelope');

    expect(getKernelSchemaVersionsResult({ schemaRoot })).toEqual({
      versions: ['v1']
    });
    expect(() => listKernelSchemas('v3', { schemaRoot })).toThrow(KernelSchemaVersionNotFoundError);
    expect(() => listKernelSchemas('v3', { schemaRoot })).toThrow(
      'Unknown Kernel schema version `v3`. Supported versions: v1.'
    );
  });

  test('shows schemas from discovered future versions without registry source edits', async () => {
    const schemaRoot = await createSchemaRoot();
    await writeCompleteSchemaVersion(schemaRoot, 'v1');
    await writeCompleteSchemaVersion(schemaRoot, 'v2', ['future-output']);

    const result = await getKernelSchemaShowResult('future-output.schema.json', 'v2', { schemaRoot });

    expect(result).toEqual({
      version: 'v2',
      schema: {
        version: 'v2',
        name: 'future-output',
        fileName: 'future-output.schema.json',
        path: join(schemaRoot, 'v2', 'future-output.schema.json')
      },
      content: {
        title: 'future-output v2'
      }
    });
  });
});

async function createSchemaRoot(): Promise<string> {
  const schemaRoot = await mkdtemp(join(tmpdir(), 'kernel-schema-registry-'));
  tempDirs.push(schemaRoot);
  return schemaRoot;
}

async function writeCompleteSchemaVersion(
  schemaRoot: string,
  version: string,
  extraNames: string[] = []
): Promise<void> {
  const coreNames = [
    'error-envelope',
    'schema-list-result',
    'schema-path-result',
    'schema-show-result',
    'schema-versions-result'
  ];

  for (const name of [...coreNames, ...extraNames]) {
    await writeSchemaFile(schemaRoot, version, name);
  }
}

async function writeSchemaFile(schemaRoot: string, version: string, name: string): Promise<void> {
  await mkdir(join(schemaRoot, version), { recursive: true });
  await writeFile(join(schemaRoot, version, `${name}.schema.json`), `${JSON.stringify({ title: `${name} ${version}` })}\n`, 'utf8');
}
