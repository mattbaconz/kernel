import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { KernelConfig } from '../config.js';
import type {
  CommandEntry,
  CommandSource,
  PackageScriptsEntry,
  TaskRunnerTask,
  WorkspacePackage
} from './types.js';
import { compareCommandEntries, compareStrings, pathExists, readPackageJson, readPackageScripts } from './utils.js';

const MAKEFILE_TARGETS = ['build', 'clean', 'install', 'lint', 'test'] as const;
const JUSTFILE_TARGETS = ['build', 'clean', 'install', 'lint', 'test'] as const;

export interface DetectCommandsResult {
  packageManager: string | null;
  scripts: CommandEntry[];
  sources: CommandSource[];
  kernelCommands: CommandEntry[];
  packageScripts: PackageScriptsEntry[];
  taskRunnerTasks: TaskRunnerTask[];
}

export async function detectPackageManager(rootDir: string): Promise<string | null> {
  if (await pathExists(join(rootDir, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (await pathExists(join(rootDir, 'package-lock.json'))) {
    return 'npm';
  }
  if (await pathExists(join(rootDir, 'yarn.lock'))) {
    return 'yarn';
  }
  if (await pathExists(join(rootDir, 'bun.lockb'))) {
    return 'bun';
  }
  if (await pathExists(join(rootDir, 'package.json'))) {
    return 'npm';
  }

  return null;
}

export async function detectCommands(
  rootDir: string,
  config: KernelConfig,
  workspacePackages: WorkspacePackage[] = []
): Promise<DetectCommandsResult> {
  const packageManager = await detectPackageManager(rootDir);
  const sources = new Set<CommandSource>();
  const scripts: CommandEntry[] = [];
  const packageScripts: PackageScriptsEntry[] = [];

  const rootScripts = await readPackageScripts(join(rootDir, 'package.json'), packageManager, 'root');
  if (rootScripts.length > 0) {
    sources.add('package.json');
    scripts.push(...rootScripts);
  }

  for (const pkg of workspacePackages) {
    const pkgScripts = await readPackageScripts(join(rootDir, pkg.path, 'package.json'), packageManager, pkg.name);
    if (pkgScripts.length > 0) {
      sources.add('package.json');
      packageScripts.push({
        package: pkg.name,
        path: pkg.path,
        scripts: pkgScripts
      });
    }
  }

  const makefileScripts = await readMakefileTargets(rootDir);
  if (makefileScripts.length > 0) {
    sources.add('makefile');
    scripts.push(...makefileScripts);
  }

  const justfileScripts = await readJustfileTargets(rootDir);
  if (justfileScripts.length > 0) {
    sources.add('justfile');
    scripts.push(...justfileScripts);
  }

  const kernelCommands = readKernelCommands(config);
  if (kernelCommands.length > 0) {
    sources.add('kernel.yaml');
  }

  const taskRunnerTasks = await detectTaskRunnerTasks(rootDir);
  if (taskRunnerTasks.length > 0) {
    if (taskRunnerTasks.some((task) => task.source === 'turbo.json')) {
      sources.add('turbo');
    }
    if (taskRunnerTasks.some((task) => task.source === 'nx.json')) {
      sources.add('nx');
    }
  }

  return {
    packageManager,
    scripts: dedupeCommands(scripts).sort(compareCommandEntries),
    sources: [...sources].sort(compareStrings) as CommandSource[],
    kernelCommands: kernelCommands.sort(compareCommandEntries),
    packageScripts: packageScripts.sort((left, right) => compareStrings(left.path, right.path)),
    taskRunnerTasks: taskRunnerTasks.sort((left, right) => compareStrings(left.name, right.name))
  };
}

function readKernelCommands(config: KernelConfig): CommandEntry[] {
  return Object.entries(config.commands)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, command]) => ({
      name,
      command,
      script: command
    }));
}

async function readMakefileTargets(rootDir: string): Promise<CommandEntry[]> {
  const makefilePath = join(rootDir, 'Makefile');
  if (!(await pathExists(makefilePath))) {
    return [];
  }

  const content = await readFile(makefilePath, 'utf8');
  const targets = parseRecipeTargets(content, MAKEFILE_TARGETS);
  return targets.map((name) => ({
    name: `make:${name}`,
    command: `make ${name}`,
    script: name
  }));
}

async function readJustfileTargets(rootDir: string): Promise<CommandEntry[]> {
  for (const fileName of ['justfile', 'Justfile']) {
    const justfilePath = join(rootDir, fileName);
    if (!(await pathExists(justfilePath))) {
      continue;
    }
    const content = await readFile(justfilePath, 'utf8');
    const targets = parseRecipeTargets(content, JUSTFILE_TARGETS);
    return targets.map((name) => ({
      name: `just:${name}`,
      command: `just ${name}`,
      script: name
    }));
  }
  return [];
}

function parseRecipeTargets(content: string, allowedTargets: readonly string[]): string[] {
  const found = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('.')) {
      continue;
    }
    const match = /^([A-Za-z0-9_.-]+)\s*:/.exec(trimmed);
    if (!match?.[1]) {
      continue;
    }
    if ((allowedTargets as readonly string[]).includes(match[1])) {
      found.add(match[1]);
    }
  }
  return [...found].sort(compareStrings);
}

async function detectTaskRunnerTasks(rootDir: string): Promise<TaskRunnerTask[]> {
  const tasks: TaskRunnerTask[] = [];
  const turboPath = join(rootDir, 'turbo.json');
  if (await pathExists(turboPath)) {
    const turboJson = await readPackageJson(turboPath);
    const pipeline = (turboJson as { pipeline?: Record<string, unknown>; tasks?: Record<string, unknown> }).pipeline
      ?? (turboJson as { tasks?: Record<string, unknown> }).tasks;
    if (pipeline && typeof pipeline === 'object') {
      for (const name of Object.keys(pipeline).sort(compareStrings)) {
        tasks.push({
          name,
          command: `turbo run ${name}`,
          source: 'turbo.json'
        });
      }
    }
  }

  const nxPath = join(rootDir, 'nx.json');
  if (await pathExists(nxPath)) {
    const nxJson = await readPackageJson(nxPath);
    const targetDefaults = (nxJson as { targetDefaults?: Record<string, unknown> }).targetDefaults;
    if (targetDefaults && typeof targetDefaults === 'object') {
      for (const name of Object.keys(targetDefaults).sort(compareStrings)) {
        tasks.push({
          name,
          command: `nx run-many --target=${name}`,
          source: 'nx.json'
        });
      }
    }
  }

  return tasks;
}

function dedupeCommands(commands: CommandEntry[]): CommandEntry[] {
  const seen = new Set<string>();
  const deduped: CommandEntry[] = [];
  for (const command of commands) {
    if (seen.has(command.name)) {
      continue;
    }
    seen.add(command.name);
    deduped.push(command);
  }
  return deduped;
}
