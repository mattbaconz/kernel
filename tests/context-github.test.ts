import { readFile } from 'node:fs/promises';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { loadKernelConfig } from '../src/core/config.js';
import { parseGitHubRemote, resolveGitHubRepo } from '../src/core/context/github.js';
import { KernelContextError } from '../src/core/context/types.js';

const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-context-${name}-`));
  tempDirs.push(dir);
  await cp(join(process.cwd(), 'tests', 'fixtures', name), dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('parseGitHubRemote', () => {
  test('parses SSH remotes', () => {
    expect(parseGitHubRemote('git@github.com:mattbaconz/kernel.git')).toEqual({
      owner: 'mattbaconz',
      repo: 'kernel'
    });
  });

  test('parses HTTPS remotes', () => {
    expect(parseGitHubRemote('https://github.com/mattbaconz/kernel-skills.git')).toEqual({
      owner: 'mattbaconz',
      repo: 'kernel-skills'
    });
  });
});

describe('resolveGitHubRepo', () => {
  test('uses context.github config when present', async () => {
    const rootDir = await copyFixture('context-pr');
    const config = await loadKernelConfig(rootDir);

    await expect(resolveGitHubRepo({ rootDir, config })).resolves.toEqual({
      owner: 'mattbaconz',
      repo: 'kernel'
    });
  });

  test('throws when owner/repo cannot be resolved', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'kernel-context-missing-'));
    tempDirs.push(rootDir);

    await expect(resolveGitHubRepo({ rootDir })).rejects.toBeInstanceOf(KernelContextError);
  });
});

describe('fixture payloads', () => {
  test('loads PR fixture JSON', async () => {
    const pull = JSON.parse(await readFile(join(process.cwd(), 'tests', 'fixtures', 'context-pr', 'pull.json'), 'utf8')) as {
      number: number;
      title: string;
    };

    expect(pull.number).toBe(42);
    expect(pull.title).toContain('GitHub context');
  });
});
