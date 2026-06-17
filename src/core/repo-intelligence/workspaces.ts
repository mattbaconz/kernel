import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';

import type { EntrypointEntry, MonorepoInfo, WorkspacePackage } from './types.js';
import { compareStrings, pathExists, readPackageJson } from './utils.js';

export interface DetectWorkspacesResult {
  monorepo: MonorepoInfo;
  packages: WorkspacePackage[];
  entrypoints: EntrypointEntry[];
}

export async function detectWorkspaces(rootDir: string): Promise<DetectWorkspacesResult> {
  const pnpmWorkspacePath = join(rootDir, 'pnpm-workspace.yaml');
  const packageJsonPath = join(rootDir, 'package.json');

  let monorepo: MonorepoInfo = { tool: null, workspaceFile: null };
  let packagePaths: string[] = [];
  const entrypoints = await readEntrypoints(packageJsonPath);

  if (await pathExists(pnpmWorkspacePath)) {
    monorepo = { tool: 'pnpm', workspaceFile: 'pnpm-workspace.yaml' };
    packagePaths = await readPnpmWorkspacePackages(pnpmWorkspacePath);
  } else if (await pathExists(packageJsonPath)) {
    const packageJson = await readPackageJson(packageJsonPath);
    const workspaces = packageJson.workspaces;
    if (Array.isArray(workspaces)) {
      monorepo = { tool: 'npm', workspaceFile: 'package.json' };
      packagePaths = workspaces.filter((entry): entry is string => typeof entry === 'string');
    } else if (
      workspaces &&
      typeof workspaces === 'object' &&
      'packages' in workspaces &&
      Array.isArray((workspaces as { packages: unknown }).packages)
    ) {
      monorepo = { tool: 'npm', workspaceFile: 'package.json' };
      packagePaths = (workspaces as { packages: unknown[] }).packages.filter(
        (entry): entry is string => typeof entry === 'string'
      );
    }
    if (await pathExists(join(rootDir, 'yarn.lock'))) {
      monorepo.tool = 'yarn';
    }
  }

  const packages: WorkspacePackage[] = [];
  for (const pattern of packagePaths.sort(compareStrings)) {
    const resolvedPackages = await resolveWorkspacePattern(rootDir, pattern);
    packages.push(...resolvedPackages);
  }

  return {
    monorepo,
    packages: dedupePackages(packages).sort((left, right) => compareStrings(left.path, right.path)),
    entrypoints: entrypoints.sort((left, right) => compareStrings(left.path, right.path))
  };
}

async function readPnpmWorkspacePackages(workspacePath: string): Promise<string[]> {
  const raw = await readFile(workspacePath, 'utf8');
  const parsed = parseYaml(raw) as { packages?: unknown };
  if (!Array.isArray(parsed.packages)) {
    return [];
  }
  return parsed.packages.filter((entry): entry is string => typeof entry === 'string');
}

async function resolveWorkspacePattern(rootDir: string, pattern: string): Promise<WorkspacePackage[]> {
  if (!pattern.includes('*')) {
    return [await readWorkspacePackage(rootDir, pattern)];
  }

  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/\/+$/g, '');
  const wildcardIndex = normalizedPattern.indexOf('*');
  const baseDir = normalizedPattern.slice(0, wildcardIndex).replace(/\/+$/g, '');
  const suffix = normalizedPattern.slice(wildcardIndex + 1).replace(/^\//, '');
  const absoluteBase = join(rootDir, baseDir);

  if (!(await pathExists(absoluteBase))) {
    return [];
  }

  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(absoluteBase, { withFileTypes: true });
  const packages: WorkspacePackage[] = [];

  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }
    const relativePath = joinRelative(baseDir, entry.name, suffix);
    const packageJsonPath = join(rootDir, relativePath, 'package.json');
    if (await pathExists(packageJsonPath)) {
      packages.push(await readWorkspacePackage(rootDir, relativePath));
    }
  }

  return packages;
}

async function readWorkspacePackage(rootDir: string, relativePath: string): Promise<WorkspacePackage> {
  const packageJsonPath = join(rootDir, relativePath, 'package.json');
  const packageJson = await readPackageJson(packageJsonPath);
  return {
    name: typeof packageJson.name === 'string' ? packageJson.name : relativePath,
    path: relativePath.replace(/\\/g, '/'),
    private: packageJson.private === true ? true : undefined
  };
}

async function readEntrypoints(packageJsonPath: string): Promise<EntrypointEntry[]> {
  if (!(await pathExists(packageJsonPath))) {
    return [];
  }

  const packageJson = await readPackageJson(packageJsonPath);
  const entrypoints: EntrypointEntry[] = [];

  if (typeof packageJson.main === 'string') {
    entrypoints.push({ path: packageJson.main, kind: 'main' });
  }
  if (typeof packageJson.module === 'string') {
    entrypoints.push({ path: packageJson.module, kind: 'module' });
  }
  if (typeof packageJson.types === 'string') {
    entrypoints.push({ path: packageJson.types, kind: 'types' });
  }
  if (typeof packageJson.bin === 'string') {
    entrypoints.push({ path: packageJson.bin, kind: 'bin' });
  } else if (packageJson.bin && typeof packageJson.bin === 'object') {
    for (const binPath of Object.values(packageJson.bin)) {
      if (typeof binPath === 'string') {
        entrypoints.push({ path: binPath, kind: 'bin' });
      }
    }
  }

  return entrypoints;
}

function dedupePackages(packages: WorkspacePackage[]): WorkspacePackage[] {
  const seen = new Set<string>();
  const deduped: WorkspacePackage[] = [];
  for (const pkg of packages) {
    if (seen.has(pkg.path)) {
      continue;
    }
    seen.add(pkg.path);
    deduped.push(pkg);
  }
  return deduped;
}

function joinRelative(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split(/[\\/]+/))
    .filter(Boolean)
    .join('/');
}
