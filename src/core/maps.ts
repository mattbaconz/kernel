import { access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { loadKernelConfig } from './config.js';
import { KernelFileExistsError, type KernelWriteAction, writeKernelFile } from './fs.js';
import { loadCodeownersRules } from './repo-intelligence/codeowners.js';
import { detectCommands } from './repo-intelligence/commands.js';
import { inferRisk } from './repo-intelligence/risk.js';
import { detectTests } from './repo-intelligence/tests.js';
import type {
  CommandEntry,
  ConfigRiskPathEntry,
  EntrypointEntry,
  MonorepoInfo,
  OwnershipEntry,
  PackageScriptsEntry,
  RepoFileEntry,
  RiskCommandEntry,
  RiskPathEntry,
  TaskRunnerTask,
  TestFramework,
  WorkspacePackage
} from './repo-intelligence/types.js';
import { compareStrings } from './repo-intelligence/utils.js';
import { detectWorkspaces } from './repo-intelligence/workspaces.js';

export type MapKind = 'repo' | 'commands' | 'tests' | 'risk';

export type {
  CommandEntry,
  ConfigRiskPathEntry,
  EntrypointEntry,
  MonorepoInfo,
  OwnershipEntry,
  PackageScriptsEntry,
  RepoFileEntry,
  RiskCommandEntry,
  RiskPathEntry,
  TaskRunnerTask,
  TestFramework,
  WorkspacePackage
};

export interface GenerateKernelMapsOptions {
  dryRun?: boolean;
  force?: boolean;
  includeDocsVault?: boolean;
  maps?: MapKind[];
}

export interface ScanRepositoryMapsOptions {
  includeDocsVault?: boolean;
}

export interface RepoMap {
  version: 2;
  files: RepoFileEntry[];
  directories: string[];
  ignoredDirectories: string[];
  summary: {
    fileCount: number;
    directoryCount: number;
  };
  monorepo: MonorepoInfo;
  packages: WorkspacePackage[];
  entrypoints: EntrypointEntry[];
}

export interface CommandsMap {
  version: 2;
  packageManager: string | null;
  scripts: CommandEntry[];
  sources: Array<'package.json' | 'makefile' | 'justfile' | 'kernel.yaml' | 'turbo' | 'nx'>;
  kernelCommands: CommandEntry[];
  packageScripts: PackageScriptsEntry[];
  taskRunnerTasks: TaskRunnerTask[];
}

export interface TestsMap {
  version: 2;
  testFiles: string[];
  testCommands: CommandEntry[];
  frameworks: TestFramework[];
  configFiles: string[];
  e2ePaths: string[];
  patterns: string[];
}

export interface RiskMap {
  version: 2;
  highRiskPaths: RiskPathEntry[];
  destructiveCommands: RiskCommandEntry[];
  ignoredDirectories: string[];
  ownership: OwnershipEntry[];
  configRiskPaths: ConfigRiskPathEntry[];
}

export interface KernelMaps {
  repo: RepoMap;
  commands: CommandsMap;
  tests: TestsMap;
  risk: RiskMap;
}

export interface MapFileResult {
  relativePath: string;
  path: string;
  action: KernelWriteAction;
}

export interface GenerateKernelMapsResult {
  maps: KernelMaps;
  files: MapFileResult[];
}

const BASE_IGNORED_DIRECTORIES = ['.git', 'dist', 'node_modules'];
const DOCS_VAULT_DIRECTORY = 'kernel_obsidian_vault';

export async function scanRepositoryMaps(
  rootDir: string = process.cwd(),
  options: ScanRepositoryMapsOptions = {}
): Promise<KernelMaps> {
  const config = await loadKernelConfig(rootDir);
  const ignoredDirectories = getIgnoredDirectories(options.includeDocsVault);
  const { files, directories } = await scanFiles(rootDir, ignoredDirectories);
  const filePaths = files.map((file) => file.path);
  const workspaceInfo = await detectWorkspaces(rootDir);
  const commandInfo = await detectCommands(rootDir, config, workspaceInfo.packages);
  const testInfo = detectTests(filePaths, commandInfo.scripts);
  const codeownersRules = await loadCodeownersRules(rootDir);
  const riskInfo = inferRisk({
    filePaths,
    scripts: commandInfo.scripts,
    ignoredDirectories,
    config,
    codeownersRules
  });

  return {
    repo: {
      version: 2,
      files,
      directories,
      ignoredDirectories,
      summary: {
        fileCount: files.length,
        directoryCount: directories.length
      },
      monorepo: workspaceInfo.monorepo,
      packages: workspaceInfo.packages,
      entrypoints: workspaceInfo.entrypoints
    },
    commands: {
      version: 2,
      packageManager: commandInfo.packageManager,
      scripts: commandInfo.scripts,
      sources: commandInfo.sources,
      kernelCommands: commandInfo.kernelCommands,
      packageScripts: commandInfo.packageScripts,
      taskRunnerTasks: commandInfo.taskRunnerTasks
    },
    tests: {
      version: 2,
      testFiles: testInfo.testFiles,
      testCommands: testInfo.testCommands,
      frameworks: testInfo.frameworks,
      configFiles: testInfo.configFiles,
      e2ePaths: testInfo.e2ePaths,
      patterns: testInfo.patterns
    },
    risk: {
      version: 2,
      highRiskPaths: riskInfo.highRiskPaths,
      destructiveCommands: riskInfo.destructiveCommands,
      ignoredDirectories,
      ownership: riskInfo.ownership,
      configRiskPaths: riskInfo.configRiskPaths
    }
  };
}

export async function generateKernelMaps(
  rootDir: string = process.cwd(),
  options: GenerateKernelMapsOptions = {}
): Promise<GenerateKernelMapsResult> {
  const maps = await scanRepositoryMaps(rootDir, { includeDocsVault: options.includeDocsVault });
  const config = await loadKernelConfig(rootDir);
  const selectedMaps = resolveSelectedMaps(options);
  const allPlans = [
    { kind: 'repo' as const, relativePath: joinRelative(config.canonical.maps_dir, 'repo.json'), content: stringifyMap(maps.repo) },
    { kind: 'commands' as const, relativePath: joinRelative(config.canonical.maps_dir, 'commands.json'), content: stringifyMap(maps.commands) },
    { kind: 'tests' as const, relativePath: joinRelative(config.canonical.maps_dir, 'tests.json'), content: stringifyMap(maps.tests) },
    { kind: 'risk' as const, relativePath: joinRelative(config.canonical.maps_dir, 'risk.json'), content: stringifyMap(maps.risk) }
  ];
  const plans = allPlans.filter((plan) => selectedMaps.has(plan.kind));

  if (!options.force && !options.dryRun) {
    await assertNoExistingMapFiles(rootDir, plans.map((plan) => plan.relativePath));
  }

  const files: MapFileResult[] = [];
  for (const plan of plans) {
    const result = await writeKernelFile({
      targetPath: join(rootDir, plan.relativePath),
      content: plan.content,
      dryRun: options.dryRun,
      force: options.force
    });
    files.push({
      relativePath: plan.relativePath,
      path: result.targetPath,
      action: result.action
    });
  }

  return { maps, files };
}

function getIgnoredDirectories(includeDocsVault: boolean | undefined): string[] {
  const ignored = includeDocsVault ? [...BASE_IGNORED_DIRECTORIES] : [...BASE_IGNORED_DIRECTORIES, DOCS_VAULT_DIRECTORY];
  return ignored.sort(compareStrings);
}

async function scanFiles(
  rootDir: string,
  ignoredDirectories: string[]
): Promise<{ files: RepoFileEntry[]; directories: string[] }> {
  const files: RepoFileEntry[] = [];
  const directories = new Set<string>();

  async function visit(relativeDir: string): Promise<void> {
    const absoluteDir = join(rootDir, relativeDir);
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    const sortedEntries = entries.sort((left, right) => compareStrings(left.name, right.name));

    for (const entry of sortedEntries) {
      const relativePath = joinRelative(relativeDir, entry.name);
      if (entry.isDirectory()) {
        if (shouldIgnoreDirectory(relativePath, entry.name, ignoredDirectories)) {
          continue;
        }
        directories.add(relativePath);
        await visit(relativePath);
        continue;
      }

      if (entry.isFile()) {
        const fileStat = await stat(join(rootDir, relativePath));
        files.push({
          path: relativePath,
          sizeBytes: fileStat.size
        });
      }
    }
  }

  await visit('');

  return {
    files: files.sort((left, right) => compareStrings(left.path, right.path)),
    directories: [...directories].sort(compareStrings)
  };
}

function shouldIgnoreDirectory(relativePath: string, name: string, ignoredDirectories: string[]): boolean {
  if (ignoredDirectories.includes(name)) {
    return true;
  }

  return relativePath === '.agent/maps';
}

async function assertNoExistingMapFiles(rootDir: string, relativePaths: string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    const path = join(rootDir, relativePath);
    if (await pathExists(path)) {
      throw new KernelFileExistsError(path);
    }
  }
}

function stringifyMap(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function joinRelative(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split(/[\\/]+/))
    .filter(Boolean)
    .join('/');
}

export function resolveSelectedMaps(options: GenerateKernelMapsOptions): Set<MapKind> {
  const subset = [options.maps?.includes('commands'), options.maps?.includes('tests'), options.maps?.includes('risk')].some(
    Boolean
  );

  if (!subset) {
    return new Set(['repo', 'commands', 'tests', 'risk']);
  }

  const selected = new Set<MapKind>();
  if (options.maps?.includes('commands')) {
    selected.add('commands');
  }
  if (options.maps?.includes('tests')) {
    selected.add('tests');
  }
  if (options.maps?.includes('risk')) {
    selected.add('risk');
  }

  return selected;
}
