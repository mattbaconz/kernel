import { access, readFile } from 'node:fs/promises';

export interface PackageJson {
  name?: unknown;
  private?: unknown;
  scripts?: Record<string, unknown>;
  workspaces?: unknown;
  main?: unknown;
  module?: unknown;
  types?: unknown;
  bin?: unknown;
}

export function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

export function compareCommandEntries<T extends { name: string }>(left: T, right: T): number {
  return compareStrings(left.name, right.name);
}

export async function pathExists(path: string): Promise<boolean> {
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

export async function readPackageJson(path: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageJson;
}

export async function readPackageScripts(
  packageJsonPath: string,
  packageManager: string | null,
  packageName: string
): Promise<import('./types.js').CommandEntry[]> {
  if (!(await pathExists(packageJsonPath)) || packageManager === null) {
    return [];
  }

  const packageJson = await readPackageJson(packageJsonPath);
  const scripts = packageJson.scripts ?? {};
  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, script]) => ({
      name,
      command: buildPackageCommand(packageManager, packageName, name),
      script
    }))
    .sort(compareCommandEntries);
}

function buildPackageCommand(packageManager: string, packageName: string, scriptName: string): string {
  if (packageName === 'root') {
    return `${packageManager} ${scriptName}`;
  }
  if (packageManager === 'pnpm') {
    return `pnpm --filter ${packageName} ${scriptName}`;
  }
  if (packageManager === 'npm') {
    return `npm run ${scriptName} --workspace=${packageName}`;
  }
  if (packageManager === 'yarn') {
    return `yarn workspace ${packageName} ${scriptName}`;
  }
  return `${packageManager} ${scriptName}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
