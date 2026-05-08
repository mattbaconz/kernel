import { access, readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { loadKernelConfig } from './config.js';
import { KernelFileExistsError, type KernelWriteAction, writeKernelFile } from './fs.js';

export interface GenerateKernelMapsOptions {
  dryRun?: boolean;
  force?: boolean;
  includeDocsVault?: boolean;
}

export interface ScanRepositoryMapsOptions {
  includeDocsVault?: boolean;
}

export interface RepoFileEntry {
  path: string;
  sizeBytes: number;
}

export interface RepoMap {
  version: 1;
  files: RepoFileEntry[];
  directories: string[];
  ignoredDirectories: string[];
  summary: {
    fileCount: number;
    directoryCount: number;
  };
}

export interface CommandEntry {
  name: string;
  command: string;
  script: string;
}

export interface CommandsMap {
  version: 1;
  packageManager: string | null;
  scripts: CommandEntry[];
}

export interface TestsMap {
  version: 1;
  testFiles: string[];
  testCommands: CommandEntry[];
}

export interface RiskPathEntry {
  path: string;
  reason: string;
}

export interface RiskCommandEntry extends CommandEntry {
  reason: string;
}

export interface RiskMap {
  version: 1;
  highRiskPaths: RiskPathEntry[];
  destructiveCommands: RiskCommandEntry[];
  ignoredDirectories: string[];
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

interface PackageJson {
  scripts?: Record<string, unknown>;
}

const BASE_IGNORED_DIRECTORIES = ['.git', 'dist', 'node_modules'];
const DOCS_VAULT_DIRECTORY = 'kernel_obsidian_vault';

export async function scanRepositoryMaps(
  rootDir: string = process.cwd(),
  options: ScanRepositoryMapsOptions = {}
): Promise<KernelMaps> {
  const ignoredDirectories = getIgnoredDirectories(options.includeDocsVault);
  const { files, directories } = await scanFiles(rootDir, ignoredDirectories);
  const packageManager = await detectPackageManager(rootDir);
  const scripts = await readPackageScripts(rootDir, packageManager);
  const testFiles = files.map((file) => file.path).filter(isTestFile).sort(compareStrings);
  const testCommands = scripts.filter((script) => script.name.includes('test')).sort(compareCommandEntries);
  const highRiskPaths = files.map((file) => file.path).flatMap(classifyHighRiskPath).sort(compareRiskPaths);
  const destructiveCommands = scripts.flatMap(classifyDestructiveCommand).sort(compareRiskCommands);

  return {
    repo: {
      version: 1,
      files,
      directories,
      ignoredDirectories,
      summary: {
        fileCount: files.length,
        directoryCount: directories.length
      }
    },
    commands: {
      version: 1,
      packageManager,
      scripts
    },
    tests: {
      version: 1,
      testFiles,
      testCommands
    },
    risk: {
      version: 1,
      highRiskPaths,
      destructiveCommands,
      ignoredDirectories
    }
  };
}

export async function generateKernelMaps(
  rootDir: string = process.cwd(),
  options: GenerateKernelMapsOptions = {}
): Promise<GenerateKernelMapsResult> {
  const maps = await scanRepositoryMaps(rootDir, { includeDocsVault: options.includeDocsVault });
  const config = await loadKernelConfig(rootDir);
  const plans = [
    { relativePath: joinRelative(config.canonical.maps_dir, 'repo.json'), content: stringifyMap(maps.repo) },
    { relativePath: joinRelative(config.canonical.maps_dir, 'commands.json'), content: stringifyMap(maps.commands) },
    { relativePath: joinRelative(config.canonical.maps_dir, 'tests.json'), content: stringifyMap(maps.tests) },
    { relativePath: joinRelative(config.canonical.maps_dir, 'risk.json'), content: stringifyMap(maps.risk) }
  ];

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

async function detectPackageManager(rootDir: string): Promise<string | null> {
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

async function readPackageScripts(rootDir: string, packageManager: string | null): Promise<CommandEntry[]> {
  const packagePath = join(rootDir, 'package.json');
  if (!(await pathExists(packagePath)) || packageManager === null) {
    return [];
  }

  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as PackageJson;
  const scripts = packageJson.scripts ?? {};
  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, script]) => ({
      name,
      command: `${packageManager} ${name}`,
      script
    }))
    .sort(compareCommandEntries);
}

function isTestFile(path: string): boolean {
  const fileName = basename(path);
  return (
    path.startsWith('tests/') ||
    path.startsWith('test/') ||
    /\.test\.[cm]?[jt]sx?$/.test(fileName) ||
    /\.spec\.[cm]?[jt]sx?$/.test(fileName)
  );
}

function classifyHighRiskPath(path: string): RiskPathEntry[] {
  if (path.startsWith('.github/workflows/')) {
    return [{ path, reason: 'CI workflow' }];
  }
  if (path.startsWith('db/migrations/')) {
    return [{ path, reason: 'database migration' }];
  }
  if (path.startsWith('infra/')) {
    return [{ path, reason: 'infrastructure' }];
  }
  if (path.startsWith('auth/') || path.includes('/auth/')) {
    return [{ path, reason: 'authentication' }];
  }
  if (path.startsWith('billing/') || path.includes('/billing/')) {
    return [{ path, reason: 'billing' }];
  }

  return [];
}

function classifyDestructiveCommand(command: CommandEntry): RiskCommandEntry[] {
  const script = command.script;
  if (script.includes('npm publish') || script.includes('pnpm publish')) {
    return [{ ...command, reason: 'package publishing' }];
  }
  if (script.includes('git push --force')) {
    return [{ ...command, reason: 'force push' }];
  }
  if (script.includes('git reset --hard')) {
    return [{ ...command, reason: 'destructive git reset' }];
  }
  if (script.includes('rm -rf')) {
    return [{ ...command, reason: 'recursive deletion' }];
  }

  return [];
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

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function compareCommandEntries(left: CommandEntry, right: CommandEntry): number {
  return compareStrings(left.name, right.name);
}

function compareRiskPaths(left: RiskPathEntry, right: RiskPathEntry): number {
  return compareStrings(left.path, right.path);
}

function compareRiskCommands(left: RiskCommandEntry, right: RiskCommandEntry): number {
  return compareStrings(left.name, right.name);
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
