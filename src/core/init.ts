import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { stringify as stringifyYaml } from 'yaml';

import { adapterTargetToConfigKey, type AdapterTarget, KernelAdapterTargetError, parseAdapterTargetList } from '../adapters/index.js';
import { DEFAULT_KERNEL_CONFIG, type KernelConfig, kernelConfigSchema } from './config.js';
import { KernelFileExistsError, type KernelWriteAction, writeKernelFile } from './fs.js';
import { renderDefaultPolicyGate } from './policy/defaults.js';

export type InitDirectoryAction = 'created' | 'exists' | 'would-create' | 'would-exist';

export interface InitializeKernelOptions {
  dryRun?: boolean;
  force?: boolean;
  adapters?: string;
}

export class KernelInitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'KernelInitError';
  }
}

export interface InitDirectoryResult {
  relativePath: string;
  path: string;
  action: InitDirectoryAction;
}

export interface InitFileResult {
  relativePath: string;
  path: string;
  action: KernelWriteAction;
}

export interface InitializeKernelResult {
  directories: InitDirectoryResult[];
  files: InitFileResult[];
}

interface InitFilePlan {
  relativePath: string;
  content: string;
  generatedHeader: boolean;
  preserveManualSections: boolean;
}

export const INIT_DIRECTORIES = [
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
] as const;

export async function initializeKernel(
  rootDir: string = process.cwd(),
  options: InitializeKernelOptions = {}
): Promise<InitializeKernelResult> {
  let enabledAdapters: AdapterTarget[] | undefined;
  if (options.adapters !== undefined) {
    try {
      enabledAdapters = parseAdapterTargetList(options.adapters);
    } catch (error) {
      if (error instanceof KernelAdapterTargetError) {
        throw new KernelInitError(error.message, { cause: error });
      }
      throw error;
    }
  }

  const filePlans = getInitFilePlans(enabledAdapters);

  if (!options.force && !options.dryRun) {
    await assertNoExistingFiles(rootDir, filePlans);
  }

  const directories = await ensureInitDirectories(rootDir, Boolean(options.dryRun));
  const files: InitFileResult[] = [];

  for (const plan of filePlans) {
    const result = await writeKernelFile({
      targetPath: join(rootDir, plan.relativePath),
      content: plan.content,
      dryRun: options.dryRun,
      force: options.force,
      generatedHeader: plan.generatedHeader,
      preserveManualSections: plan.preserveManualSections
    });
    files.push({
      relativePath: plan.relativePath,
      path: result.targetPath,
      action: result.action
    });
  }

  return { directories, files };
}

export function renderDefaultKernelConfig(enabledAdapters?: AdapterTarget[]): string {
  return stringifyYaml(buildInitKernelConfig(enabledAdapters));
}

export function buildInitKernelConfig(enabledAdapters?: AdapterTarget[]): KernelConfig {
  if (enabledAdapters === undefined) {
    return DEFAULT_KERNEL_CONFIG;
  }

  const adapters = Object.fromEntries(
    Object.keys(DEFAULT_KERNEL_CONFIG.adapters).map((key) => [key, false])
  ) as KernelConfig['adapters'];

  for (const target of enabledAdapters) {
    adapters[adapterTargetToConfigKey(target)] = true;
  }

  return kernelConfigSchema.parse({
    ...DEFAULT_KERNEL_CONFIG,
    adapters
  });
}

export function renderDefaultAgentsMd(): string {
  return [
    '# AGENTS.md',
    '',
    'This repository uses **Kernel**, a repo-local quality system and portable operating layer for coding agents.',
    '',
    '## Prime directive',
    '',
    'No contract, no implementation. No evidence, no completion. No handoff, no continuity.',
    '',
    '## Working rules',
    '',
    '1. Read this `AGENTS.md` before non-trivial implementation.',
    '2. Read `.agent/kernel.yaml` if present.',
    '3. Create or update `.agent/state/current-task.md` before implementation.',
    '4. Prefer minimal, testable changes.',
    '5. Record verification evidence before claiming completion.',
    '6. Create a handoff packet when work is incomplete, long-running, or likely to move to another ADE.',
    '',
    '<!-- kernel:manual:start -->',
    '',
    '<!-- kernel:manual:end -->',
    ''
  ].join('\n');
}

function getInitFilePlans(enabledAdapters?: AdapterTarget[]): InitFilePlan[] {
  return [
    {
      relativePath: '.agent/kernel.yaml',
      content: renderDefaultKernelConfig(enabledAdapters),
      generatedHeader: false,
      preserveManualSections: false
    },
    {
      relativePath: '.agent/policies/policy-gate.yaml',
      content: renderDefaultPolicyGate(buildInitKernelConfig(enabledAdapters)),
      generatedHeader: false,
      preserveManualSections: false
    },
    {
      relativePath: 'AGENTS.md',
      content: renderDefaultAgentsMd(),
      generatedHeader: true,
      preserveManualSections: true
    }
  ];
}

async function ensureInitDirectories(rootDir: string, dryRun: boolean): Promise<InitDirectoryResult[]> {
  const results: InitDirectoryResult[] = [];

  for (const relativePath of INIT_DIRECTORIES) {
    const path = join(rootDir, relativePath);
    const exists = await pathExists(path);

    if (!dryRun && !exists) {
      await mkdir(path, { recursive: true });
    }

    results.push({
      relativePath,
      path,
      action: getDirectoryAction(exists, dryRun)
    });
  }

  return results;
}

async function assertNoExistingFiles(rootDir: string, filePlans: InitFilePlan[]): Promise<void> {
  for (const plan of filePlans) {
    const path = join(rootDir, plan.relativePath);
    if (await pathExists(path)) {
      throw new KernelFileExistsError(path);
    }
  }
}

function getDirectoryAction(exists: boolean, dryRun: boolean): InitDirectoryAction {
  if (exists) {
    return dryRun ? 'would-exist' : 'exists';
  }

  return dryRun ? 'would-create' : 'created';
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
