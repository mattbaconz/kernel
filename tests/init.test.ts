import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { KernelFileExistsError } from '../src/core/fs.js';
import { initializeKernel } from '../src/core/init.js';
import { GENERATED_FILE_HEADER, MANUAL_END, MANUAL_START } from '../src/core/manual-sections.js';

const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-init-${name}-`));
  tempDirs.push(dir);
  const fixturePath = join(process.cwd(), 'tests', 'fixtures', name);
  await cp(fixturePath, dir, { recursive: true });
  return dir;
}

async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('initializeKernel', () => {
  test('creates the .agent directory tree and default files in an empty repo', async () => {
    const rootDir = await copyFixture('init-empty');

    const result = await initializeKernel(rootDir);

    expect(result.directories.map((entry) => entry.relativePath)).toEqual([
      '.agent',
      '.agent/state',
      '.agent/contracts',
      '.agent/maps',
      '.agent/policies',
      '.agent/evidence',
      '.agent/handoffs',
      '.agent/skills',
      '.agent/adapters',
      '.agent/evals'
    ]);
    expect(result.files.map((entry) => entry.relativePath)).toEqual([
      '.agent/kernel.yaml',
      '.agent/policies/policy-gate.yaml',
      'AGENTS.md'
    ]);
    expect(result.files.map((entry) => entry.action)).toEqual(['created', 'created', 'created']);

    await expect(readText(join(rootDir, '.agent', 'kernel.yaml'))).resolves.toContain('overwrite: false');
    await expect(readText(join(rootDir, '.agent', 'kernel.yaml'))).resolves.toContain('github_copilot: true');
    await expect(readText(join(rootDir, 'AGENTS.md'))).resolves.toContain(GENERATED_FILE_HEADER);
    await expect(readText(join(rootDir, 'AGENTS.md'))).resolves.toContain('No contract, no implementation.');
  });

  test('supports dry-run without creating directories or files', async () => {
    const rootDir = await copyFixture('init-empty');

    const result = await initializeKernel(rootDir, { dryRun: true });

    expect(result.directories.every((entry) => entry.action === 'would-create')).toBe(true);
    expect(result.files.map((entry) => entry.action)).toEqual(['would-create', 'would-create', 'would-create']);
    await expect(readText(join(rootDir, '.agent', 'kernel.yaml'))).rejects.toThrow();
    await expect(readText(join(rootDir, 'AGENTS.md'))).rejects.toThrow();
  });

  test('refuses to overwrite an existing user-authored AGENTS.md by default', async () => {
    const rootDir = await copyFixture('init-existing-files');
    const originalAgents = await readText(join(rootDir, 'AGENTS.md'));

    await expect(initializeKernel(rootDir)).rejects.toBeInstanceOf(KernelFileExistsError);

    await expect(readText(join(rootDir, 'AGENTS.md'))).resolves.toBe(originalAgents);
  });

  test('allows force overwrite and preserves manual sections in generated AGENTS.md', async () => {
    const rootDir = await copyFixture('init-existing-generated');

    const result = await initializeKernel(rootDir, { force: true });

    expect(result.files.find((entry) => entry.relativePath === 'AGENTS.md')?.action).toBe('updated');
    const agents = await readText(join(rootDir, 'AGENTS.md'));
    expect(agents).toContain(GENERATED_FILE_HEADER);
    expect(agents).toContain(MANUAL_START);
    expect(agents).toContain('Keep this repository-specific instruction.');
    expect(agents).toContain(MANUAL_END);
    expect(agents).toContain('No contract, no implementation.');
  });

  test('refuses to overwrite an existing user-authored config by default before writing files', async () => {
    const rootDir = await copyFixture('init-empty');
    await mkdir(dirname(join(rootDir, '.agent', 'kernel.yaml')), { recursive: true });
    await mkdir(join(rootDir, '.agent'), { recursive: true });
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(join(rootDir, '.agent', 'kernel.yaml'), 'version: custom\n', 'utf8')
    );

    await expect(initializeKernel(rootDir)).rejects.toBeInstanceOf(KernelFileExistsError);

    await expect(readText(join(rootDir, 'AGENTS.md'))).rejects.toThrow();
  });

  test('seeds adapter flags when --adapters is provided', async () => {
    const rootDir = await copyFixture('init-empty');

    await initializeKernel(rootDir, { adapters: 'codex,gemini' });

    const config = await readText(join(rootDir, '.agent', 'kernel.yaml'));
    expect(config).toContain('codex: true');
    expect(config).toContain('gemini: true');
    expect(config).toContain('claude: false');
    expect(config).toContain('github_copilot: false');
  });

  test('rejects unknown adapter targets during init', async () => {
    const rootDir = await copyFixture('init-empty');

    await expect(initializeKernel(rootDir, { adapters: 'codex,unknown-ade' })).rejects.toThrow(
      'Unknown adapter target(s): unknown-ade'
    );
  });
});
