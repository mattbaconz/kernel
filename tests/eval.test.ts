import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { KernelConfigError } from '../src/core/config.js';
import { KernelFileExistsError } from '../src/core/fs.js';
import {
  createStaticSkillEvalRunner,
  formatSkillEvalJsonResult,
  formatSkillEvalResult,
  KernelEvalRunnerError,
  listSkillEvalRunnerManifests,
  renderSkillEvalSummary,
  runSkillEvals,
  type SkillEvalRunner
} from '../src/core/eval.js';

const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-eval-${name}-`));
  tempDirs.push(dir);
  await cp(join(process.cwd(), 'tests', 'fixtures', name), dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runSkillEvals', () => {
  test('loads validated skill fixtures and reports deterministic static passes', async () => {
    const rootDir = await copyFixture('eval-skills');

    const result = await runSkillEvals(rootDir);

    expect(result.status).toBe('pass');
    expect(result.runnerId).toBe('static');
    expect(result.fixtureCount).toBe(2);
    expect(result.passCount).toBe(2);
    expect(result.skipCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.results).toEqual([
      {
        status: 'pass',
        skillName: 'evidence-ledger',
        name: 'evidence ledger activation',
        path: '.agent/evals/skills/evidence-ledger/basic.yaml',
        reason: 'Static fixture loaded; live ADE execution was not run.',
        runner: {
          name: 'static-noop',
          mode: 'static',
          executed: false,
          outcome: 'pass',
          reason: 'Static fixture loaded; live ADE execution was not run.'
        }
      },
      {
        status: 'pass',
        skillName: 'kernel-core',
        name: 'kernel core activation',
        path: '.agent/evals/skills/kernel-core/basic.yaml',
        reason: 'Static fixture loaded; live ADE execution was not run.',
        runner: {
          name: 'static-noop',
          mode: 'static',
          executed: false,
          outcome: 'pass',
          reason: 'Static fixture loaded; live ADE execution was not run.'
        }
      }
    ]);
  });

  test('exposes a static no-op runner as the default runner contract', async () => {
    const rootDir = await copyFixture('eval-skills');
    const runner = createStaticSkillEvalRunner();

    const result = await runSkillEvals(rootDir);

    expect(runner.name).toBe('static-noop');
    expect(runner.mode).toBe('static');
    expect(result.runner).toEqual({
      name: 'static-noop',
      mode: 'static'
    });
    expect(result.results.every((entry) => entry.runner.executed === false)).toBe(true);
  });

  test('lists deterministic safe eval runner registry metadata', () => {
    expect(listSkillEvalRunnerManifests()).toEqual([
      {
        id: 'static',
        runnerName: 'static-noop',
        mode: 'static',
        enabled: true,
        safeByDefault: true,
        description: 'Deterministic static fixture evaluation; no live ADE execution.'
      },
      {
        id: 'live',
        runnerName: 'live-ade',
        mode: 'live',
        enabled: false,
        safeByDefault: false,
        description: 'Reserved for future live ADE execution; disabled by default.'
      }
    ]);
  });

  test('selects the static runner from the registry by runner id', async () => {
    const rootDir = await copyFixture('eval-skills');

    const result = await runSkillEvals(rootDir, { runnerId: 'static' });

    expect(result.status).toBe('pass');
    expect(result.runner).toEqual({
      name: 'static-noop',
      mode: 'static'
    });
    expect(result.results.every((entry) => entry.runner.executed === false)).toBe(true);
  });

  test('uses the configured default eval runner when no runner id is provided', async () => {
    const rootDir = await copyFixture('eval-skills-config-static');

    const result = await runSkillEvals(rootDir);

    expect(result.status).toBe('pass');
    expect(result.runner).toEqual({
      name: 'static-noop',
      mode: 'static'
    });
    expect(result.results.every((entry) => entry.runner.executed === false)).toBe(true);
  });

  test('rejects unsafe configured default eval runner from a fixture repository', async () => {
    const rootDir = await copyFixture('eval-skills-config-live');

    await expect(runSkillEvals(rootDir)).rejects.toBeInstanceOf(KernelConfigError);
  });

  test('rejects unknown configured default eval runner from a fixture repository', async () => {
    const rootDir = await copyFixture('eval-skills-config-unknown');

    await expect(runSkillEvals(rootDir)).rejects.toBeInstanceOf(KernelConfigError);
  });

  test('rejects unknown runner ids before fixture execution', async () => {
    const rootDir = await copyFixture('eval-skills');
    const promise = runSkillEvals(rootDir, { runnerId: 'unknown' });

    await expect(promise).rejects.toBeInstanceOf(KernelEvalRunnerError);
    await expect(promise).rejects.toMatchObject({
      name: 'KernelEvalRunnerError',
      runnerId: 'unknown',
      code: 'unknown_runner'
    });
  });

  test('rejects live runner manifests by default', async () => {
    const rootDir = await copyFixture('eval-skills');
    const promise = runSkillEvals(rootDir, { runnerId: 'live' });

    await expect(promise).rejects.toBeInstanceOf(KernelEvalRunnerError);
    await expect(promise).rejects.toMatchObject({
      name: 'KernelEvalRunnerError',
      runnerId: 'live',
      code: 'unsafe_runner'
    });
  });

  test('accepts an injected runner and keeps fixture ordering deterministic', async () => {
    const rootDir = await copyFixture('eval-skills');
    const runner: SkillEvalRunner = {
      name: 'fixture-live-runner',
      mode: 'live',
      run: async (fixture) => ({
        outcome: 'pass',
        executed: true,
        reason: `Runner accepted ${fixture.name}.`,
        details: {
          expectedSkills: fixture.expectedSkills
        }
      })
    };

    const result = await runSkillEvals(rootDir, { runner });

    expect(result.status).toBe('pass');
    expect(result.runner).toEqual({
      name: 'fixture-live-runner',
      mode: 'live'
    });
    expect(result.results.map((entry) => `${entry.runner.name}:${entry.runner.executed}:${entry.reason}`)).toEqual([
      'fixture-live-runner:true:Runner accepted evidence ledger activation.',
      'fixture-live-runner:true:Runner accepted kernel core activation.'
    ]);
    expect(result.results[0]?.runner.details).toEqual({
      expectedSkills: ['evidence-ledger']
    });
  });

  test('aggregates injected runner failures without changing static skip behavior', async () => {
    const rootDir = await copyFixture('eval-skills');
    const runner: SkillEvalRunner = {
      name: 'fixture-live-runner',
      mode: 'live',
      run: async (fixture) => ({
        outcome: fixture.skillName === 'kernel-core' ? 'fail' : 'pass',
        executed: true,
        reason: fixture.skillName === 'kernel-core' ? 'Runner rejected kernel-core.' : 'Runner accepted fixture.'
      })
    };

    const result = await runSkillEvals(rootDir, { runner });

    expect(result.status).toBe('fail');
    expect(result.passCount).toBe(1);
    expect(result.failCount).toBe(1);
    expect(result.skipCount).toBe(0);
    expect(result.results.map((entry) => `${entry.status}:${entry.path}`)).toEqual([
      'pass:.agent/evals/skills/evidence-ledger/basic.yaml',
      'fail:.agent/evals/skills/kernel-core/basic.yaml'
    ]);
  });

  test('filters by skill and reports nonmatching validated fixtures as skips', async () => {
    const rootDir = await copyFixture('eval-skills');

    const result = await runSkillEvals(rootDir, { skill: 'kernel-core' });

    expect(result.status).toBe('pass');
    expect(result.skillFilter).toBe('kernel-core');
    expect(result.fixtureCount).toBe(2);
    expect(result.passCount).toBe(1);
    expect(result.skipCount).toBe(1);
    expect(result.results.map((entry) => `${entry.status}:${entry.path}`)).toEqual([
      'skip:.agent/evals/skills/evidence-ledger/basic.yaml',
      'pass:.agent/evals/skills/kernel-core/basic.yaml'
    ]);
  });

  test('surfaces lint warnings and does not run invalid fixtures', async () => {
    const rootDir = await copyFixture('skills-invalid');

    const result = await runSkillEvals(rootDir);

    expect(result.status).toBe('warn');
    expect(result.fixtureCount).toBe(0);
    expect(result.passCount).toBe(0);
    expect(result.skipCount).toBe(0);
    expect(result.warningCount).toBe(8);
    expect(result.issues.some((issue) => issue.code === 'invalid_skill_fixture')).toBe(true);
  });

  test('formats eval output deterministically for the CLI', async () => {
    const rootDir = await copyFixture('eval-skills');

    const result = await runSkillEvals(rootDir, { skill: 'kernel-core' });

    expect(formatSkillEvalResult(result)).toMatchInlineSnapshot(`
      "Skill eval status: pass
      Skill filter: kernel-core
      Fixtures: 2
      Passed: 1
      Skipped: 1
      Warnings: 0
      skip .agent/evals/skills/evidence-ledger/basic.yaml - Filtered out by --skill \`kernel-core\`.
      pass .agent/evals/skills/kernel-core/basic.yaml - Static fixture loaded; live ADE execution was not run."
    `);
  });

  test('formats eval JSON output with runner id, fixture results, and summary write metadata', async () => {
    const rootDir = await copyFixture('eval-skills');

    const result = await runSkillEvals(rootDir, {
      skill: 'kernel-core',
      summaryPath: '.agent/evidence/eval-summary.md',
      dryRun: true
    });
    const parsed = JSON.parse(formatSkillEvalJsonResult(result)) as {
      schemaVersion: number;
      status: string;
      skillFilter: string;
      runnerId: string;
      runner: {
        name: string;
        mode: string;
      };
      fixtureCount: number;
      passCount: number;
      failCount: number;
      skipCount: number;
      warningCount: number;
      results: Array<{
        status: string;
        skillName: string;
        name: string;
        path: string;
        reason: string;
        runner: {
          name: string;
          mode: string;
          executed: boolean;
          outcome: string;
          reason: string;
        };
      }>;
      files: Array<{
        relativePath: string;
        path: string;
        action: string;
      }>;
      summary: {
        relativePath: string;
        path: string;
        action: string;
        dryRun: boolean;
      };
    };

    expect(parsed).toEqual({
      schemaVersion: 1,
      status: 'pass',
      skillFilter: 'kernel-core',
      runnerId: 'static',
      runner: {
        name: 'static-noop',
        mode: 'static'
      },
      fixtureCount: 2,
      passCount: 1,
      failCount: 0,
      skipCount: 1,
      warningCount: 0,
      issues: [],
      results: [
        {
          status: 'skip',
          skillName: 'evidence-ledger',
          name: 'evidence ledger activation',
          path: '.agent/evals/skills/evidence-ledger/basic.yaml',
          reason: 'Filtered out by --skill `kernel-core`.',
          runner: {
            name: 'static-noop',
            mode: 'static',
            outcome: 'skip',
            executed: false,
            reason: 'Filtered out by --skill `kernel-core`.'
          }
        },
        {
          status: 'pass',
          skillName: 'kernel-core',
          name: 'kernel core activation',
          path: '.agent/evals/skills/kernel-core/basic.yaml',
          reason: 'Static fixture loaded; live ADE execution was not run.',
          runner: {
            name: 'static-noop',
            mode: 'static',
            outcome: 'pass',
            executed: false,
            reason: 'Static fixture loaded; live ADE execution was not run.'
          }
        }
      ],
      files: [
        {
          relativePath: '.agent/evidence/eval-summary.md',
          path: join(rootDir, '.agent', 'evidence', 'eval-summary.md'),
          action: 'would-create'
        }
      ],
      summary: {
        relativePath: '.agent/evidence/eval-summary.md',
        path: join(rootDir, '.agent', 'evidence', 'eval-summary.md'),
        action: 'would-create',
        dryRun: true
      }
    });
  });

  test('renders an evidence-ready summary', async () => {
    const rootDir = await copyFixture('eval-skills');

    const summary = renderSkillEvalSummary(await runSkillEvals(rootDir, { skill: 'kernel-core' }));

    expect(summary).toContain('# Skill Eval Summary');
    expect(summary).toContain('| pass | kernel-core | kernel core activation |');
    expect(summary).toContain('This foundation does not execute prompts through a live ADE.');
  });

  test('optionally writes a summary with safe writer behavior', async () => {
    const rootDir = await copyFixture('eval-skills');

    const result = await runSkillEvals(rootDir, {
      summaryPath: '.agent/evidence/eval-summary.md'
    });

    expect(result.files).toEqual([
      {
        relativePath: '.agent/evidence/eval-summary.md',
        path: join(rootDir, '.agent', 'evidence', 'eval-summary.md'),
        action: 'created'
      }
    ]);
    await expect(readFile(join(rootDir, '.agent', 'evidence', 'eval-summary.md'), 'utf8')).resolves.toContain(
      '# Skill Eval Summary'
    );
  });

  test('supports dry-run summary writes and refuses existing summaries without force', async () => {
    const rootDir = await copyFixture('eval-skills');

    const dryRun = await runSkillEvals(rootDir, {
      summaryPath: '.agent/evidence/eval-summary.md',
      dryRun: true
    });
    expect(dryRun.files[0]?.action).toBe('would-create');
    await expect(readFile(join(rootDir, '.agent', 'evidence', 'eval-summary.md'), 'utf8')).rejects.toThrow();

    await runSkillEvals(rootDir, { summaryPath: '.agent/evidence/eval-summary.md' });
    await expect(
      runSkillEvals(rootDir, {
        summaryPath: '.agent/evidence/eval-summary.md'
      })
    ).rejects.toBeInstanceOf(KernelFileExistsError);

    const forced = await runSkillEvals(rootDir, {
      summaryPath: '.agent/evidence/eval-summary.md',
      force: true
    });
    expect(forced.files[0]?.action).toBe('updated');
  });
});
