import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KERNEL_SCHEMA_VERSION_DIRECTORY = 'v1';
export type KernelSchemaVersion = string;

const REQUIRED_SCHEMA_NAMES = [
  'error-envelope',
  'schema-list-result',
  'schema-path-result',
  'schema-show-result',
  'schema-versions-result'
] as const;

export type KernelSchemaName = string;

export interface KernelSchemaRegistryOptions {
  schemaRoot?: string;
}

export interface KernelSchemaDescriptor {
  version: KernelSchemaVersion;
  name: KernelSchemaName;
  fileName: string;
  path: string;
}

export interface KernelSchemaListResult {
  schemas: KernelSchemaDescriptor[];
}

export interface KernelSchemaPathResult {
  version: KernelSchemaVersion;
  path: string;
  schema?: KernelSchemaDescriptor;
}

export interface KernelSchemaShowResult {
  version: KernelSchemaVersion;
  schema: KernelSchemaDescriptor;
  content: unknown;
}

export interface KernelSchemaVersionsResult {
  versions: KernelSchemaVersion[];
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_SCHEMA_ROOT = join(REPO_ROOT, 'schemas', 'json');
const SCHEMA_VERSION_PATTERN = /^v\d+$/u;
const SCHEMA_FILE_PATTERN = /^[a-z0-9-]+\.schema\.json$/u;

export class KernelSchemaNotFoundError extends Error {
  constructor(readonly schemaName: string) {
    super(`Unknown Kernel schema \`${schemaName}\`. Run \`kernel schema list\` to see available schemas.`);
    this.name = 'KernelSchemaNotFoundError';
  }
}

export class KernelSchemaVersionNotFoundError extends Error {
  constructor(
    readonly schemaVersionId: string,
    readonly supportedVersions: string[] = discoverKernelSchemaVersions()
  ) {
    super(
      `Unknown Kernel schema version \`${schemaVersionId}\`. Supported versions: ${formatSupportedVersions(supportedVersions)}.`
    );
    this.name = 'KernelSchemaVersionNotFoundError';
  }
}

export function getKernelSchemaDirectory(
  version?: string,
  options: KernelSchemaRegistryOptions = {}
): string {
  return getSchemaDirectory(resolveKernelSchemaVersion(version, options), options);
}

export function getKernelSchemaVersionsResult(options: KernelSchemaRegistryOptions = {}): KernelSchemaVersionsResult {
  return {
    versions: discoverKernelSchemaVersions(options)
  };
}

export function listKernelSchemas(
  version?: string,
  options: KernelSchemaRegistryOptions = {}
): KernelSchemaDescriptor[] {
  const resolvedVersion = resolveKernelSchemaVersion(version, options);
  const schemaDirectory = getSchemaDirectory(resolvedVersion, options);
  return readdirSync(schemaDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SCHEMA_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => fileName.replace(/\.schema\.json$/u, ''))
    .map((name) => ({
      version: resolvedVersion,
      name,
      fileName: toSchemaFileName(name),
      path: join(schemaDirectory, toSchemaFileName(name))
    }));
}

export function getKernelSchemaListResult(
  version?: string,
  options: KernelSchemaRegistryOptions = {}
): KernelSchemaListResult {
  return {
    schemas: listKernelSchemas(version, options)
  };
}

export function getKernelSchemaPathResult(
  schemaName?: string,
  version?: string,
  options: KernelSchemaRegistryOptions = {}
): KernelSchemaPathResult {
  const resolvedVersion = resolveKernelSchemaVersion(version, options);
  const normalizedName = normalizeSchemaName(schemaName);
  if (normalizedName === null) {
    return {
      version: resolvedVersion,
      path: getSchemaDirectory(resolvedVersion, options)
    };
  }

  const descriptor = listKernelSchemas(resolvedVersion, options).find((schema) => schema.name === normalizedName);
  if (descriptor === undefined) {
    throw new KernelSchemaNotFoundError(normalizedName);
  }

  return {
    version: resolvedVersion,
    path: descriptor.path,
    schema: descriptor
  };
}

export function resolveKernelSchemaPath(
  schemaName?: string,
  version?: string,
  options: KernelSchemaRegistryOptions = {}
): string {
  return getKernelSchemaPathResult(schemaName, version, options).path;
}

export async function readKernelSchema(
  schemaName: string,
  version?: string,
  options: KernelSchemaRegistryOptions = {}
): Promise<string> {
  return await readFile(resolveKernelSchemaPath(schemaName, version, options), 'utf8');
}

export async function getKernelSchemaShowResult(
  schemaName: string,
  version?: string,
  options: KernelSchemaRegistryOptions = {}
): Promise<KernelSchemaShowResult> {
  const pathResult = getKernelSchemaPathResult(schemaName, version, options);
  if (pathResult.schema === undefined) {
    throw new KernelSchemaNotFoundError(schemaName);
  }

  return {
    version: pathResult.version,
    schema: pathResult.schema,
    content: JSON.parse(await readKernelSchema(schemaName, version, options)) as unknown
  };
}

function normalizeSchemaName(schemaName: string | undefined): KernelSchemaName | string | null {
  const normalized = schemaName?.trim().replace(/\.schema\.json$/iu, '');
  return normalized && normalized.length > 0 ? normalized : null;
}

function toSchemaFileName(name: string): string {
  return `${name}.schema.json`;
}

function resolveKernelSchemaVersion(
  version: string | undefined,
  options: KernelSchemaRegistryOptions = {}
): KernelSchemaVersion {
  const supportedVersions = discoverKernelSchemaVersions(options);
  const requestedVersion = version?.trim() || getLatestSchemaVersion(supportedVersions);
  if (supportedVersions.includes(requestedVersion)) {
    return requestedVersion;
  }

  throw new KernelSchemaVersionNotFoundError(requestedVersion, supportedVersions);
}

function discoverKernelSchemaVersions(options: KernelSchemaRegistryOptions = {}): KernelSchemaVersion[] {
  const schemaRoot = getSchemaRoot(options);
  if (!existsSync(schemaRoot)) {
    return [];
  }

  return readdirSync(schemaRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SCHEMA_VERSION_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .filter((version) => isCompleteSchemaVersion(schemaRoot, version))
    .sort(compareSchemaVersions);
}

function getLatestSchemaVersion(supportedVersions: string[]): string {
  return supportedVersions.at(-1) ?? KERNEL_SCHEMA_VERSION_DIRECTORY;
}

function isCompleteSchemaVersion(schemaRoot: string, version: string): boolean {
  return REQUIRED_SCHEMA_NAMES.every((name) => existsSync(join(schemaRoot, version, toSchemaFileName(name))));
}

function getSchemaRoot(options: KernelSchemaRegistryOptions): string {
  return options.schemaRoot ?? DEFAULT_SCHEMA_ROOT;
}

function getSchemaDirectory(version: KernelSchemaVersion, options: KernelSchemaRegistryOptions = {}): string {
  return join(getSchemaRoot(options), version);
}

function compareSchemaVersions(left: string, right: string): number {
  return schemaVersionNumber(left) - schemaVersionNumber(right) || left.localeCompare(right);
}

function schemaVersionNumber(version: string): number {
  return Number.parseInt(version.slice(1), 10);
}

function formatSupportedVersions(supportedVersions: string[]): string {
  return supportedVersions.length > 0 ? supportedVersions.join(', ') : 'none';
}
