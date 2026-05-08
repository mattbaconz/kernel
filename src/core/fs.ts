import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { preserveManualSections, withGeneratedHeader } from './manual-sections.js';

export type KernelWriteAction = 'created' | 'updated' | 'would-create' | 'would-update';

export interface WriteKernelFileOptions {
  targetPath: string;
  content: string;
  dryRun?: boolean;
  force?: boolean;
  generatedHeader?: boolean;
  preserveManualSections?: boolean;
}

export interface WriteKernelFileResult {
  targetPath: string;
  action: KernelWriteAction;
  content: string;
}

export class KernelFileExistsError extends Error {
  constructor(readonly targetPath: string) {
    super(`Refusing to overwrite existing file without force: ${targetPath}`);
    this.name = 'KernelFileExistsError';
  }
}

export async function writeKernelFile(options: WriteKernelFileOptions): Promise<WriteKernelFileResult> {
  const existingContent = await readOptionalFile(options.targetPath);
  const exists = existingContent !== null;

  if (exists && !options.force && !options.dryRun) {
    throw new KernelFileExistsError(options.targetPath);
  }

  let nextContent = options.content;
  if (options.preserveManualSections && existingContent !== null) {
    nextContent = preserveManualSections(nextContent, existingContent);
  }
  if (options.generatedHeader) {
    nextContent = withGeneratedHeader(nextContent);
  }

  const action = getWriteAction(exists, Boolean(options.dryRun));
  if (!options.dryRun) {
    await mkdir(dirname(options.targetPath), { recursive: true });
    await writeFile(options.targetPath, nextContent, 'utf8');
  }

  return {
    targetPath: options.targetPath,
    action,
    content: nextContent
  };
}

function getWriteAction(exists: boolean, dryRun: boolean): KernelWriteAction {
  if (exists) {
    return dryRun ? 'would-update' : 'updated';
  }

  return dryRun ? 'would-create' : 'created';
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
