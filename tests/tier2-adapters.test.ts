import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { getAdapter } from '../src/adapters/index.js';
import { compileAdapters } from '../src/core/adapter-compiler.js';
import { GENERATED_FILE_HEADER } from '../src/core/manual-sections.js';

const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-tier2-adapters-${name}-`));
  tempDirs.push(dir);
  await cp(join(process.cwd(), 'tests', 'fixtures', name), dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('tier 2 adapters', () => {
  test('renders Zed outputs', async () => {
    const rootDir = await copyFixture('compile-all-basic');
    const result = await compileAdapters(rootDir, [getAdapter('zed')], { dryRun: true });
    expect(result.files.map((file) => file.relativePath)).toEqual(['.rules']);
    expect(result.files.every((file) => file.content.startsWith(GENERATED_FILE_HEADER))).toBe(true);
  });

  test('renders OpenCode mirrored skill outputs', async () => {
    const rootDir = await copyFixture('compile-all-basic');
    const result = await compileAdapters(rootDir, [getAdapter('opencode')], { dryRun: true });
    expect(result.files.map((file) => file.relativePath)).toEqual([
      '.opencode/skills/kernel-core/SKILL.md',
      '.agents/skills/kernel-core/SKILL.md'
    ]);
  });

  test('renders Windsurf rule and workflow outputs', async () => {
    const rootDir = await copyFixture('compile-all-basic');
    const result = await compileAdapters(rootDir, [getAdapter('windsurf')], { dryRun: true });
    expect(result.files.map((file) => file.relativePath)).toEqual([
      '.windsurf/rules/kernel-core.md',
      '.windsurf/workflows/kernel-review.md'
    ]);
  });

  test('renders Junie AGENTS output', async () => {
    const rootDir = await copyFixture('compile-all-basic');
    const result = await compileAdapters(rootDir, [getAdapter('junie')], { dryRun: true });
    expect(result.files.map((file) => file.relativePath)).toEqual(['.junie/AGENTS.md']);
    expect(result.files[0]?.content).toContain('## Junie workflow');
  });
});
