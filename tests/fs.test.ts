import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { KernelFileExistsError, writeKernelFile } from '../src/core/fs.js';
import { GENERATED_FILE_HEADER } from '../src/core/manual-sections.js';

const tempDirs: string[] = [];

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kernel-fs-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('writeKernelFile', () => {
  test('refuses to overwrite an existing file by default', async () => {
    const rootDir = await createTempRepo();
    const targetPath = join(rootDir, 'AGENTS.md');
    await writeFile(targetPath, 'user content\n', 'utf8');

    await expect(writeKernelFile({ targetPath, content: 'generated content\n' })).rejects.toBeInstanceOf(
      KernelFileExistsError
    );

    await expect(readFile(targetPath, 'utf8')).resolves.toBe('user content\n');
  });

  test('allows overwrite with force', async () => {
    const rootDir = await createTempRepo();
    const targetPath = join(rootDir, 'AGENTS.md');
    await writeFile(targetPath, 'old content\n', 'utf8');

    const result = await writeKernelFile({
      targetPath,
      content: 'new content\n',
      force: true
    });

    expect(result.action).toBe('updated');
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('new content\n');
  });

  test('supports dry-run without writing', async () => {
    const rootDir = await createTempRepo();
    const targetPath = join(rootDir, 'AGENTS.md');

    const result = await writeKernelFile({
      targetPath,
      content: 'generated content\n',
      dryRun: true
    });

    expect(result.action).toBe('would-create');
    await expect(readFile(targetPath, 'utf8')).rejects.toThrow();
  });

  test('adds a generated file header when requested', async () => {
    const rootDir = await createTempRepo();
    const targetPath = join(rootDir, 'AGENTS.md');

    await writeKernelFile({
      targetPath,
      content: 'body\n',
      generatedHeader: true
    });

    await expect(readFile(targetPath, 'utf8')).resolves.toBe(`${GENERATED_FILE_HEADER}\n\nbody\n`);
  });
});
