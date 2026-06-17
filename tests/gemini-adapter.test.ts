import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { getAdapter } from '../src/adapters/index.js';
import { compileAdapters } from '../src/core/adapter-compiler.js';
import { GENERATED_FILE_HEADER } from '../src/core/manual-sections.js';

const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-gemini-${name}-`));
  tempDirs.push(dir);
  await cp(join(process.cwd(), 'tests', 'fixtures', name), dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('gemini adapter', () => {
  test('renders GEMINI.md and .gemini/settings.json', async () => {
    const rootDir = await copyFixture('compile-all-basic');

    const result = await compileAdapters(rootDir, [getAdapter('gemini')], { dryRun: true });

    expect(result.files.map((file) => file.relativePath)).toEqual(['GEMINI.md', '.gemini/settings.json']);
    expect(result.files[0]?.content).toContain(`${GENERATED_FILE_HEADER}`);
    expect(result.files[0]?.content).toContain('# GEMINI.md');
    expect(result.files[0]?.content).toContain('No contract, no implementation');
    expect(result.files[1]?.content).toContain('"instructionsFile": "GEMINI.md"');
    expect(result.files[1]?.content).toContain('"canonicalAgentDir": ".agent"');
  });
});
