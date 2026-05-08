import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { DEFAULT_KERNEL_CONFIG } from '../src/core/config.js';
import { resolveCanonicalPaths } from '../src/core/paths.js';

const tempDirs: string[] = [];

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kernel-paths-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resolveCanonicalPaths', () => {
  test('resolves canonical .agent paths relative to the repository root', async () => {
    const rootDir = await createTempRepo();

    const paths = resolveCanonicalPaths(rootDir, DEFAULT_KERNEL_CONFIG);

    expect(paths.agentDir).toBe(resolve(rootDir, '.agent'));
    expect(paths.skillsDir).toBe(resolve(rootDir, '.agent/skills'));
    expect(paths.stateDir).toBe(resolve(rootDir, '.agent/state'));
    expect(paths.evidenceDir).toBe(resolve(rootDir, '.agent/evidence'));
    expect(paths.handoffDir).toBe(resolve(rootDir, '.agent/handoffs'));
    expect(paths.mapsDir).toBe(resolve(rootDir, '.agent/maps'));
    expect(paths.configFile).toBe(resolve(rootDir, '.agent/kernel.yaml'));
  });
});
