import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { KernelFileExistsError } from '../src/core/fs.js';
import { generateKernelMaps, scanRepositoryMaps } from '../src/core/maps.js';

const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-maps-${name}-`));
  tempDirs.push(dir);
  await cp(join(process.cwd(), 'tests', 'fixtures', name), dir, { recursive: true });
  if (name === 'maps-basic') {
    await mkdir(join(dir, 'dist'), { recursive: true });
    await mkdir(join(dir, 'node_modules'), { recursive: true });
    await mkdir(join(dir, 'kernel_obsidian_vault'), { recursive: true });
    await writeFile(join(dir, 'dist', 'ignored.js'), 'export const ignored = true;\n', 'utf8');
    await writeFile(join(dir, 'node_modules', 'ignored.js'), 'export const ignored = true;\n', 'utf8');
    await writeFile(join(dir, 'kernel_obsidian_vault', 'Ignored.md'), '# Ignored docs fixture\n', 'utf8');
  }
  return dir;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('scanRepositoryMaps', () => {
  test('builds deterministic v2 maps and ignores generated/documentation directories by default', async () => {
    const rootDir = await copyFixture('maps-basic');

    const maps = await scanRepositoryMaps(rootDir);

    expect(maps.repo.version).toBe(2);
    expect(maps.commands.version).toBe(2);
    expect(maps.tests.version).toBe(2);
    expect(maps.risk.version).toBe(2);
    expect(maps.repo.files.map((file) => file.path)).toEqual([
      '.github/workflows/ci.yml',
      'package.json',
      'pnpm-lock.yaml',
      'src/index.ts',
      'src/lib/util.ts',
      'tests/index.test.ts'
    ]);
    expect(maps.repo.files.map((file) => file.path)).not.toContain('node_modules/ignored.js');
    expect(maps.repo.files.map((file) => file.path)).not.toContain('dist/ignored.js');
    expect(maps.repo.files.map((file) => file.path)).not.toContain('kernel_obsidian_vault/Ignored.md');
    expect(maps.repo.monorepo).toEqual({ tool: null, workspaceFile: null });
    expect(maps.repo.packages).toEqual([]);
    expect(maps.commands.packageManager).toBe('pnpm');
    expect(maps.commands.sources).toEqual(['package.json']);
    expect(maps.commands.scripts).toEqual([
      { name: 'build', command: 'pnpm build', script: 'tsc -p tsconfig.json' },
      { name: 'lint', command: 'pnpm lint', script: 'eslint .' },
      { name: 'release', command: 'pnpm release', script: 'npm publish' },
      { name: 'test', command: 'pnpm test', script: 'vitest run' }
    ]);
    expect(maps.commands.kernelCommands).toEqual([]);
    expect(maps.commands.packageScripts).toEqual([]);
    expect(maps.commands.taskRunnerTasks).toEqual([]);
    expect(maps.tests.testFiles).toEqual(['tests/index.test.ts']);
    expect(maps.tests.testCommands).toEqual([{ name: 'test', command: 'pnpm test', script: 'vitest run' }]);
    expect(maps.tests.frameworks).toEqual(['vitest']);
    expect(maps.tests.configFiles).toEqual([]);
    expect(maps.tests.e2ePaths).toEqual([]);
    expect(maps.risk.highRiskPaths).toEqual([
      { path: '.github/workflows/ci.yml', reason: 'CI workflow' }
    ]);
    expect(maps.risk.destructiveCommands).toEqual([
      {
        name: 'release',
        command: 'pnpm release',
        script: 'npm publish',
        reason: 'package publishing'
      }
    ]);
    expect(maps.risk.ownership).toEqual([]);
    expect(maps.risk.configRiskPaths).toEqual([]);
  });

  test('can explicitly include the documentation vault', async () => {
    const rootDir = await copyFixture('maps-basic');

    const maps = await scanRepositoryMaps(rootDir, { includeDocsVault: true });

    expect(maps.repo.files.map((file) => file.path)).toContain('kernel_obsidian_vault/Ignored.md');
  });

  test('detects makefile targets alongside package scripts', async () => {
    const rootDir = await copyFixture('maps-makefile');

    const maps = await scanRepositoryMaps(rootDir);

    expect(maps.commands.sources).toEqual(['makefile', 'package.json']);
    expect(maps.commands.scripts.map((script) => script.name)).toEqual([
      'make:build',
      'make:lint',
      'make:test',
      'test'
    ]);
  });

  test('detects vitest config, frameworks, and e2e paths', async () => {
    const rootDir = await copyFixture('maps-vitest');

    const maps = await scanRepositoryMaps(rootDir);

    expect(maps.tests.frameworks).toEqual(['playwright', 'vitest']);
    expect(maps.tests.configFiles).toEqual(['vitest.config.ts']);
    expect(maps.tests.e2ePaths).toEqual(['e2e']);
    expect(maps.tests.testFiles).toEqual(['e2e/login.spec.ts', 'src/__tests__/app.test.ts']);
    expect(maps.tests.patterns.length).toBeGreaterThan(0);
  });

  test('merges CODEOWNERS ownership and configured risk paths', async () => {
    const rootDir = await copyFixture('maps-codeowners');

    const maps = await scanRepositoryMaps(rootDir);

    expect(maps.risk.configRiskPaths).toEqual([
      { pattern: 'src/auth/**', reason: 'configured high-risk path' }
    ]);
    expect(maps.risk.highRiskPaths).toEqual([{ path: 'src/auth/login.ts', reason: 'authentication' }]);
    expect(maps.risk.ownership).toEqual([
      {
        path: 'src/auth/login.ts',
        owners: ['@platform-leads', '@security-team'],
        source: 'codeowners'
      }
    ]);
  });

  test('detects pnpm workspace packages and per-package scripts', async () => {
    const rootDir = await copyFixture('maps-monorepo');

    const maps = await scanRepositoryMaps(rootDir);

    expect(maps.repo.monorepo).toEqual({ tool: 'pnpm', workspaceFile: 'pnpm-workspace.yaml' });
    expect(maps.repo.packages).toEqual([
      { name: '@maps-monorepo/app', path: 'packages/app' },
      { name: '@maps-monorepo/lib', path: 'packages/lib' }
    ]);
    expect(maps.repo.entrypoints).toEqual([{ path: 'dist/index.js', kind: 'main' }]);
    expect(maps.commands.packageScripts).toEqual([
      {
        package: '@maps-monorepo/app',
        path: 'packages/app',
        scripts: [
          { name: 'build', command: 'pnpm --filter @maps-monorepo/app build', script: 'tsc -p tsconfig.json' },
          { name: 'test', command: 'pnpm --filter @maps-monorepo/app test', script: 'vitest run' }
        ]
      },
      {
        package: '@maps-monorepo/lib',
        path: 'packages/lib',
        scripts: [{ name: 'test', command: 'pnpm --filter @maps-monorepo/lib test', script: 'vitest run' }]
      }
    ]);
  });
});

describe('generateKernelMaps', () => {
  test('writes all map files through the safe writer', async () => {
    const rootDir = await copyFixture('maps-basic');

    const result = await generateKernelMaps(rootDir);

    expect(result.files.map((file) => file.relativePath)).toEqual([
      '.agent/maps/repo.json',
      '.agent/maps/commands.json',
      '.agent/maps/tests.json',
      '.agent/maps/risk.json'
    ]);
    expect(result.files.map((file) => file.action)).toEqual(['created', 'created', 'created', 'created']);
    await expect(readJson(join(rootDir, '.agent', 'maps', 'repo.json'))).resolves.toMatchObject({
      version: 2,
      summary: { fileCount: 6 }
    });
    await expect(readJson(join(rootDir, '.agent', 'maps', 'commands.json'))).resolves.toMatchObject({
      version: 2,
      packageManager: 'pnpm'
    });
    await expect(readJson(join(rootDir, '.agent', 'maps', 'tests.json'))).resolves.toMatchObject({
      version: 2,
      testFiles: ['tests/index.test.ts']
    });
    await expect(readJson(join(rootDir, '.agent', 'maps', 'risk.json'))).resolves.toMatchObject({
      version: 2,
      highRiskPaths: [{ path: '.github/workflows/ci.yml', reason: 'CI workflow' }]
    });
  });

  test('supports dry-run without writing map files', async () => {
    const rootDir = await copyFixture('maps-basic');

    const result = await generateKernelMaps(rootDir, { dryRun: true });

    expect(result.files.map((file) => file.action)).toEqual([
      'would-create',
      'would-create',
      'would-create',
      'would-create'
    ]);
    await expect(readFile(join(rootDir, '.agent', 'maps', 'repo.json'), 'utf8')).rejects.toThrow();
  });

  test('refuses to overwrite existing map files by default before writing others', async () => {
    const rootDir = await copyFixture('maps-existing');
    const originalRepoMap = await readFile(join(rootDir, '.agent', 'maps', 'repo.json'), 'utf8');

    await expect(generateKernelMaps(rootDir)).rejects.toBeInstanceOf(KernelFileExistsError);

    await expect(readFile(join(rootDir, '.agent', 'maps', 'repo.json'), 'utf8')).resolves.toBe(originalRepoMap);
    await expect(readFile(join(rootDir, '.agent', 'maps', 'commands.json'), 'utf8')).rejects.toThrow();
  });

  test('allows force overwrite for existing map files', async () => {
    const rootDir = await copyFixture('maps-existing');

    const result = await generateKernelMaps(rootDir, { force: true });

    expect(result.files.find((file) => file.relativePath === '.agent/maps/repo.json')?.action).toBe('updated');
    await expect(readJson(join(rootDir, '.agent', 'maps', 'repo.json'))).resolves.toMatchObject({
      version: 2
    });
  });

  test('writes only commands.json when --commands subset is selected', async () => {
    const rootDir = await copyFixture('maps-basic');

    const result = await generateKernelMaps(rootDir, { maps: ['commands'] });

    expect(result.files.map((file) => file.relativePath)).toEqual(['.agent/maps/commands.json']);
    await expect(readFile(join(rootDir, '.agent', 'maps', 'repo.json'), 'utf8')).rejects.toThrow();
    await expect(readJson(join(rootDir, '.agent', 'maps', 'commands.json'))).resolves.toMatchObject({
      version: 2,
      packageManager: 'pnpm'
    });
  });
});
