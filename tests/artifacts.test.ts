import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  createEvidenceLedger,
  createHandoffPacket,
  createTaskContract,
  renderEvidenceLedger,
  renderHandoffPacket,
  renderTaskContract
} from '../src/core/artifacts.js';
import { KernelFileExistsError } from '../src/core/fs.js';

const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-artifacts-${name}-`));
  tempDirs.push(dir);
  await cp(join(process.cwd(), 'tests', 'fixtures', name), dir, { recursive: true });
  return dir;
}

async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('artifact renderers', () => {
  test('renders a task contract template', () => {
    const content = renderTaskContract({
      id: 'fix-session',
      type: 'bugfix',
      goal: 'Fix expired session handling',
      nonGoals: ['Do not change auth provider'],
      riskZones: ['auth/session'],
      verification: ['pnpm test -- session']
    });

    expect(content).toContain('# Task Contract: fix-session');
    expect(content).toContain('Type: bugfix');
    expect(content).toContain('Goal: Fix expired session handling');
    expect(content).toContain('- Do not change auth provider');
    expect(content).toContain('- auth/session');
    expect(content).toContain('- pnpm test -- session');
  });

  test('renders evidence and handoff templates for a task id', () => {
    expect(renderEvidenceLedger('fix-session')).toContain('# Evidence Ledger: fix-session');
    expect(renderEvidenceLedger('fix-session')).toContain('unverified / partially_verified / verified');
    expect(renderHandoffPacket('fix-session')).toContain('# Handoff Packet: fix-session');
    expect(renderHandoffPacket('fix-session')).toContain('## Next recommended action');
  });
});

describe('artifact writers', () => {
  test('creates a task contract and updates current task state', async () => {
    const rootDir = await copyFixture('artifacts-empty');

    const result = await createTaskContract(rootDir, {
      id: 'fix-session',
      type: 'bugfix',
      goal: 'Fix expired session handling',
      nonGoals: ['Do not change auth provider'],
      riskZones: ['auth/session'],
      verification: ['pnpm test -- session']
    });

    expect(result.taskId).toBe('fix-session');
    expect(result.files.map((entry) => entry.relativePath)).toEqual([
      '.agent/contracts/fix-session.md',
      '.agent/state/current-task.md'
    ]);
    expect(result.files.map((entry) => entry.action)).toEqual(['created', 'created']);

    await expect(readText(join(rootDir, '.agent', 'contracts', 'fix-session.md'))).resolves.toContain(
      'Goal: Fix expired session handling'
    );
    await expect(readText(join(rootDir, '.agent', 'state', 'current-task.md'))).resolves.toContain(
      '# Task Contract: fix-session'
    );
  });

  test('supports dry-run without writing task files', async () => {
    const rootDir = await copyFixture('artifacts-empty');

    const result = await createTaskContract(rootDir, {
      id: 'dry-run-task',
      type: 'feature',
      goal: 'Preview task creation',
      dryRun: true
    });

    expect(result.files.map((entry) => entry.action)).toEqual(['would-create', 'would-create']);
    await expect(readText(join(rootDir, '.agent', 'contracts', 'dry-run-task.md'))).rejects.toThrow();
    await expect(readText(join(rootDir, '.agent', 'state', 'current-task.md'))).rejects.toThrow();
  });

  test('refuses to overwrite an existing task contract by default', async () => {
    const rootDir = await copyFixture('artifacts-existing-contract');
    const original = await readText(join(rootDir, '.agent', 'contracts', 'existing-task.md'));

    await expect(
      createTaskContract(rootDir, {
        id: 'existing-task',
        type: 'feature',
        goal: 'Replace existing task'
      })
    ).rejects.toBeInstanceOf(KernelFileExistsError);

    await expect(readText(join(rootDir, '.agent', 'contracts', 'existing-task.md'))).resolves.toBe(original);
    await expect(readText(join(rootDir, '.agent', 'state', 'current-task.md'))).rejects.toThrow();
  });

  test('allows force overwrite for existing task contracts', async () => {
    const rootDir = await copyFixture('artifacts-existing-contract');

    const result = await createTaskContract(rootDir, {
      id: 'existing-task',
      type: 'refactor',
      goal: 'Replace existing task',
      force: true
    });

    expect(result.files.find((entry) => entry.relativePath === '.agent/contracts/existing-task.md')?.action).toBe(
      'updated'
    );
    await expect(readText(join(rootDir, '.agent', 'contracts', 'existing-task.md'))).resolves.toContain(
      'Type: refactor'
    );
  });

  test('creates evidence and handoff artifacts for the current task', async () => {
    const rootDir = await copyFixture('artifacts-current-task');

    const evidenceResult = await createEvidenceLedger(rootDir, { task: 'current' });
    const handoffResult = await createHandoffPacket(rootDir, { task: 'current' });

    expect(evidenceResult.taskId).toBe('current-task');
    expect(handoffResult.taskId).toBe('current-task');
    expect(evidenceResult.files[0]?.relativePath).toBe('.agent/evidence/current-task.md');
    expect(handoffResult.files[0]?.relativePath).toBe('.agent/handoffs/current-task.md');
    await expect(readText(join(rootDir, '.agent', 'evidence', 'current-task.md'))).resolves.toContain(
      '# Evidence Ledger: current-task'
    );
    await expect(readText(join(rootDir, '.agent', 'handoffs', 'current-task.md'))).resolves.toContain(
      '# Handoff Packet: current-task'
    );
  });

  test('supports explicit task ids for evidence and handoff dry-runs', async () => {
    const rootDir = await copyFixture('artifacts-empty');

    const evidenceResult = await createEvidenceLedger(rootDir, { task: 'explicit-task', dryRun: true });
    const handoffResult = await createHandoffPacket(rootDir, { task: 'explicit-task', dryRun: true });

    expect(evidenceResult.files[0]?.action).toBe('would-create');
    expect(handoffResult.files[0]?.action).toBe('would-create');
    await expect(readText(join(rootDir, '.agent', 'evidence', 'explicit-task.md'))).rejects.toThrow();
    await expect(readText(join(rootDir, '.agent', 'handoffs', 'explicit-task.md'))).rejects.toThrow();
  });
});
