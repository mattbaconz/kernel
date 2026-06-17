import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { KernelAdapter } from '../adapters/types.js';
import { loadCanonicalSkills } from '../adapters/canonical-skills.js';
import { loadKernelConfig } from './config.js';
import { KernelFileExistsError, type KernelWriteAction, writeKernelFile } from './fs.js';
import { preserveManualSections, withGeneratedHeader } from './manual-sections.js';

export interface CompileAdapterOptions {
  dryRun?: boolean;
  force?: boolean;
}

export interface CompileAdapterFileResult {
  adapterName: string;
  relativePath: string;
  path: string;
  action: KernelWriteAction;
  content: string;
}

export interface CompileAdapterResult {
  adapterName: string;
  files: CompileAdapterFileResult[];
}

export interface CompileAdaptersResult {
  adapterNames: string[];
  files: CompileAdapterFileResult[];
}

export async function compileAdapter(
  rootDir: string = process.cwd(),
  adapter: KernelAdapter,
  options: CompileAdapterOptions = {}
): Promise<CompileAdapterResult> {
  const result = await compileAdapters(rootDir, [adapter], options);
  return {
    adapterName: adapter.name,
    files: result.files
  };
}

export async function compileAdapters(
  rootDir: string = process.cwd(),
  adapters: KernelAdapter[],
  options: CompileAdapterOptions = {}
): Promise<CompileAdaptersResult> {
  const config = await loadKernelConfig(rootDir);
  const canonicalSkills = await loadCanonicalSkills(rootDir, config);
  const adapterOutputs = adapters.map((adapter) => ({
    adapterName: adapter.name,
    outputs: adapter.render({ config, canonicalSkills })
  }));
  const outputs = adapterOutputs.flatMap(({ adapterName, outputs }) =>
    outputs.map((output) => ({ adapterName, output }))
  );
  const dedupedOutputs = dedupeAdapterOutputs(outputs);

  if (!options.force && !options.dryRun) {
    await assertNoExistingOutputs(rootDir, dedupedOutputs.map(({ output }) => output.path));
  }

  const files: CompileAdapterFileResult[] = [];
  for (const { adapterName, output } of dedupedOutputs) {
    const targetPath = join(rootDir, output.path);
    const existingContent = output.preserveManualSections ? await readExistingGeneratedFile(targetPath) : undefined;
    const content = output.generated ? renderGeneratedAdapterFile(output.content, existingContent) : output.content;
    const result = await writeKernelFile({
      targetPath,
      content,
      dryRun: options.dryRun,
      force: options.force
    });
    files.push({
      adapterName,
      relativePath: output.path,
      path: result.targetPath,
      action: result.action,
      content: result.content
    });
  }

  return {
    adapterNames: adapters.map((adapter) => adapter.name),
    files
  };
}

export function renderGeneratedAdapterFile(content: string, existingContent?: string): string {
  const preserved = existingContent === undefined ? content : preserveManualSections(content, existingContent);
  return withGeneratedHeader(preserved);
}

function dedupeAdapterOutputs<T extends { adapterName: string; output: { path: string } }>(outputs: T[]): T[] {
  const deduped = new Map<string, T>();
  for (const entry of outputs) {
    if (!deduped.has(entry.output.path)) {
      deduped.set(entry.output.path, entry);
    }
  }
  return [...deduped.values()];
}

async function assertNoExistingOutputs(rootDir: string, relativePaths: string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    const path = join(rootDir, relativePath);
    if (await pathExists(path)) {
      throw new KernelFileExistsError(path);
    }
  }
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

export async function readExistingGeneratedFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}
