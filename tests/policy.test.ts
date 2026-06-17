import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { loadKernelConfig } from '../src/core/config.js';
import { checkPolicy } from '../src/core/policy/check.js';
import { classifyCommand, classifyPath } from '../src/core/policy/evaluate.js';
import { inferVerificationLevel, loadTaskContext, resolveEscalation } from '../src/core/policy/escalation.js';
import { loadPolicies } from '../src/core/policy/loader.js';
import { checkCiPolicy } from '../src/core/policy/ci.js';

const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-policy-${name}-`));
  tempDirs.push(dir);
  await cp(join(process.cwd(), 'tests', 'fixtures', name), dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('loadPolicies', () => {
  test('loads policy-gate.yaml from fixture', async () => {
    const rootDir = await copyFixture('policy-basic');
    const config = await loadKernelConfig(rootDir);
    const { policyGate, sourceFiles } = await loadPolicies(rootDir, config);

    expect(sourceFiles).toEqual(['.agent/policies/policy-gate.yaml']);
    expect(policyGate.commands.some((rule) => rule.match === 'npm publish')).toBe(true);
    expect(policyGate.paths.some((rule) => rule.pattern === 'src/core/**')).toBe(true);
  });

  test('merges kernel.yaml destructive commands into defaults when no policy file exists', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'kernel-policy-empty-'));
    tempDirs.push(rootDir);
    await mkdir(join(rootDir, '.agent'), { recursive: true });
    await cp(join(process.cwd(), 'tests', 'fixtures', 'policy-basic', '.agent', 'kernel.yaml'), join(rootDir, '.agent', 'kernel.yaml'));

    const config = await loadKernelConfig(rootDir);
    const { policyGate } = await loadPolicies(rootDir, config);

    expect(policyGate.commands.some((rule) => rule.match === 'npm publish')).toBe(true);
  });
});

describe('evaluate policy', () => {
  test('classifies blocked commands', async () => {
    const rootDir = await copyFixture('policy-basic');
    const { policyGate } = await loadPolicies(rootDir);

    const result = classifyCommand('pnpm publish --access public', policyGate);

    expect(result.policyClass).toBe('block');
  });

  test('classifies review paths', async () => {
    const rootDir = await copyFixture('policy-review-path');
    const { policyGate } = await loadPolicies(rootDir);

    const result = classifyPath('src/auth/login.ts', policyGate);

    expect(result.policyClass).toBe('review');
    expect(result.reason).toContain('authentication');
  });
});

describe('checkPolicy', () => {
  test('flags blocked commands from commands.json during passive scan', async () => {
    const rootDir = await copyFixture('policy-blocked-command');

    const result = await checkPolicy({ rootDir });

    expect(result.status).toBe('fail');
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        code: 'policy_command_blocked',
        path: 'npm release'
      })
    );
  });

  test('reports missing CI checks', async () => {
    const rootDir = await copyFixture('policy-ci-missing');

    const result = await checkPolicy({ rootDir, ci: true });

    expect(result.violations).toContainEqual(
      expect.objectContaining({
        code: 'missing_ci_check',
        message: expect.stringContaining('pnpm lint')
      })
    );
  });

  test('reports insufficient verification for migration tasks', async () => {
    const rootDir = await copyFixture('policy-escalation');

    const result = await checkPolicy({ rootDir, task: 'current' });

    expect(result.violations).toContainEqual(
      expect.objectContaining({
        code: 'insufficient_verification_level',
        path: '.agent/evidence/migration-task.md'
      })
    );
  });
});

describe('escalation', () => {
  test('requires L5 for migration task type', async () => {
    const rootDir = await copyFixture('policy-escalation');
    const { policyGate } = await loadPolicies(rootDir);
    const task = await loadTaskContext(rootDir, 'current');

    const requirement = resolveEscalation(policyGate, task, task.riskZones);
    const actual = inferVerificationLevel(task);

    expect(requirement.minVerification).toBe('L5');
    expect(actual).toBe('L1');
  });
});

describe('checkCiPolicy', () => {
  test('detects github actions provider and missing checks', async () => {
    const rootDir = await copyFixture('policy-ci-missing');
    const { policyGate } = await loadPolicies(rootDir);

    const result = await checkCiPolicy(rootDir, policyGate);

    expect(result.provider).toBe('github-actions');
    expect(result.missingChecks).toEqual(['pnpm lint']);
  });
});
