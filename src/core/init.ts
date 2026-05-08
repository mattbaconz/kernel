import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { stringify as stringifyYaml } from 'yaml';

import { DEFAULT_KERNEL_CONFIG } from './config.js';
import { KernelFileExistsError, type KernelWriteAction, writeKernelFile } from './fs.js';

export type InitDirectoryAction = 'created' | 'exists' | 'would-create' | 'would-exist';

export interface InitializeKernelOptions {
  dryRun?: boolean;
  force?: boolean;
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
  const filePlans = getInitFilePlans();

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

export function renderDefaultKernelConfig(): string {
  return stringifyYaml(DEFAULT_KERNEL_CONFIG);
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

function getInitFilePlans(): InitFilePlan[] {
  return [
    {
      relativePath: '.agent/kernel.yaml',
      content: renderDefaultKernelConfig(),
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
