#!/usr/bin/env node
/* global console, process */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function verifyPackedCli() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'kernel-packed-cli-'));

  try {
    const packDir = join(tempRoot, 'pack');
    const installRoot = join(tempRoot, 'install');
    const targetRepo = join(tempRoot, 'repo');
    await mkdir(packDir, { recursive: true });
    await mkdir(join(installRoot, 'node_modules'), { recursive: true });
    await mkdir(targetRepo, { recursive: true });

    await assertBuiltCliExists();
    const packedPackage = await packProject(packDir);
    const packageDir = await installPackedPackage(packedPackage.tarballPath, installRoot, packedPackage.packageName);
    const cliPath = await resolveInstalledCliPath(packageDir);
    await linkRuntimeDependencies(installRoot);
    await createReleaseFixture(targetRepo);

    await runKernel(cliPath, ['--help'], targetRepo);
    await runKernel(cliPath, ['init'], targetRepo);
    await runKernel(cliPath, ['skill', 'generate', '--docs-vault', 'public_docs_fixture', '--set', 'lint-ready', '--json'], targetRepo);
    await writeKernelCoreEvalFixture(targetRepo);
    await runKernel(cliPath, ['map', '--force'], targetRepo);
    await runKernel(cliPath, ['compile', 'all', '--force'], targetRepo);

    assertJsonStatus(await runKernel(cliPath, ['validate', '--json'], targetRepo), 'pass');
    assertJsonStatus(await runKernel(cliPath, ['skill', 'lint', '--json'], targetRepo), 'pass');
    const evalResult = assertJsonStatus(await runKernel(cliPath, ['eval', '--json'], targetRepo), 'pass');
    assertEqual(evalResult.runnerId, 'static', 'Expected packed CLI eval to use the static runner.');
    assertEqual(evalResult.fixtureCount, 1, 'Expected packed CLI eval to load one fixture.');

    const schemaVersions = parseJson(await runKernel(cliPath, ['schema', 'versions', '--json'], targetRepo));
    assertDeepEqual(schemaVersions.versions, ['v1'], 'Expected packed CLI schema discovery to find v1.');
    const schemaList = parseJson(await runKernel(cliPath, ['schema', 'list', '--json'], targetRepo));
    assertEqual(schemaList.schemas.length, 9, 'Expected packed CLI to discover all v1 schemas.');
    const schemaPath = parseJson(await runKernel(cliPath, ['schema', 'path', 'skill-eval-result', '--json'], targetRepo));
    assertEqual(schemaPath.schema.name, 'skill-eval-result', 'Expected packed CLI schema path metadata.');
    const schemaShow = parseJson(await runKernel(cliPath, ['schema', 'show', 'skill-eval-result', '--json'], targetRepo));
    assertEqual(schemaShow.content.title, 'Kernel Skill Eval Result v1', 'Expected packed CLI schema show content.');

    console.log('Packed CLI verification passed.');
  } finally {
    if (process.env.KERNEL_KEEP_PACKED_VERIFY_TEMP !== '1') {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function assertBuiltCliExists() {
  await assertPathExists(join(repoRoot, 'dist', 'cli', 'index.js'), 'Run `pnpm build` before `pnpm verify:packed`.');
}

async function packProject(packDir) {
  const result = runCommand(getNpmCommand(), getNpmArgs(['pack', '--json', '--pack-destination', packDir]), repoRoot);
  const packEntries = parseJson(result.stdout);
  const packEntry = packEntries[0];
  if (!packEntry || typeof packEntry.filename !== 'string') {
    throw new Error('Unable to resolve npm pack tarball path from npm output.');
  }
  if (typeof packEntry.name !== 'string') {
    throw new Error('Unable to resolve npm package name from npm output.');
  }

  const packedFiles = new Set(packEntry.files.map((entry) => entry.path));
  for (const requiredFile of [
    'dist/cli/index.js',
    'dist/core/schema-registry.js',
    'schemas/json/v1/skill-eval-result.schema.json'
  ]) {
    if (!packedFiles.has(requiredFile)) {
      throw new Error(`Packed tarball is missing required file: ${requiredFile}`);
    }
  }

  return {
    packageName: packEntry.name,
    tarballPath: resolve(packDir, packEntry.filename)
  };
}

async function installPackedPackage(tarballPath, installRoot, packageName) {
  const packageDir = getNodeModulePath(installRoot, packageName);
  await mkdir(packageDir, { recursive: true });
  runCommand(getTarCommand(), ['-xzf', tarballPath, '-C', packageDir, '--strip-components=1'], repoRoot);
  return packageDir;
}

function getNodeModulePath(installRoot, packageName) {
  const packageParts = packageName.split('/');
  if (packageParts.some((part) => part.length === 0)) {
    throw new Error(`Invalid npm package name in pack output: ${packageName}`);
  }

  return join(installRoot, 'node_modules', ...packageParts);
}

async function resolveInstalledCliPath(packageDir) {
  const packageJson = parseJson(await readFile(join(packageDir, 'package.json'), 'utf8'));
  const binPath = packageJson.bin?.kernel;
  if (typeof binPath !== 'string') {
    throw new Error('Packed package does not expose `bin.kernel`.');
  }

  const cliPath = join(packageDir, binPath.replace(/^\.\//u, ''));
  await assertPathExists(cliPath, 'Packed package bin target is missing.');
  return cliPath;
}

async function linkRuntimeDependencies(installRoot) {
  const packageJson = parseJson(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  const dependencies = Object.keys(packageJson.dependencies ?? {});

  for (const dependency of dependencies) {
    const sourcePath = join(repoRoot, 'node_modules', ...dependency.split('/'));
    const targetPath = join(installRoot, 'node_modules', ...dependency.split('/'));
    await assertPathExists(sourcePath, `Runtime dependency is not installed locally: ${dependency}`);
    await mkdir(dirname(targetPath), { recursive: true });
    await createDependencyLink(sourcePath, targetPath);
  }
}

async function createDependencyLink(sourcePath, targetPath) {
  if (existsSync(targetPath)) {
    return;
  }

  try {
    await symlink(sourcePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    await cp(sourcePath, targetPath, { recursive: true });
  }
}

async function createReleaseFixture(rootDir) {
  await mkdir(join(rootDir, 'src'), { recursive: true });
  await mkdir(join(rootDir, 'tests'), { recursive: true });
  await writeJsonFile(join(rootDir, 'package.json'), {
    name: 'packed-cli-fixture',
    version: '0.0.0',
    scripts: {
      test: 'vitest run',
      build: 'tsc -p tsconfig.json'
    },
    dependencies: {}
  });
  await writeFile(join(rootDir, 'src', 'index.ts'), 'export const answer = 42;\n', 'utf8');
  await writeFile(join(rootDir, 'tests', 'index.test.ts'), 'import "../src/index";\n', 'utf8');
  await cp(
    join(repoRoot, 'tests', 'fixtures', 'skill-generate-basic', 'public_docs_fixture'),
    join(rootDir, 'public_docs_fixture'),
    { recursive: true }
  );
}

async function writeKernelCoreEvalFixture(rootDir) {
  const fixtureDir = join(rootDir, '.agent', 'evals', 'skills', 'kernel-core');
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(
    join(fixtureDir, 'basic.yaml'),
    [
      'name: kernel core activation',
      'prompt: Implement a non-trivial feature.',
      'expected:',
      '  activates: true',
      '  skills:',
      '    - kernel-core',
      ''
    ].join('\n'),
    'utf8'
  );
}

async function runKernel(cliPath, args, cwd) {
  return runCommand(process.execPath, [cliPath, ...args], cwd).stdout;
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false'
    }
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (result.error) {
    throw new Error(`Command failed to start: ${command} ${args.join(' ')}\n${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        `cwd: ${cwd}`,
        `exit: ${result.status ?? 'unknown'}`,
        stdout.trim() ? `stdout:\n${stdout}` : '',
        stderr.trim() ? `stderr:\n${stderr}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  return {
    stdout,
    stderr
  };
}

function assertJsonStatus(stdout, status) {
  const parsed = parseJson(stdout);
  assertEqual(parsed.schemaVersion, 1, 'Expected Kernel JSON schemaVersion 1.');
  assertEqual(parsed.status, status, `Expected Kernel JSON status ${status}.`);
  return parsed;
}

function parseJson(value) {
  return JSON.parse(value);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

async function assertPathExists(path, message) {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

async function writeJsonFile(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function getTarCommand() {
  return process.platform === 'win32' ? 'tar.exe' : 'tar';
}

function getNpmCommand() {
  return process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
}

function getNpmArgs(args) {
  return process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd', ...args] : args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await verifyPackedCli();
}
