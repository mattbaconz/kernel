import { join } from 'node:path';

import { loadKernelConfig } from './config.js';
import { type KernelWriteAction, writeKernelFile } from './fs.js';
import { formatKernelJsonResult } from './json-output.js';
import { lintKernelSkills, type SkillLintIssue, type SkillRegressionFixturePlan } from './skills.js';

export type SkillEvalStatus = 'pass' | 'warn' | 'fail';
export type SkillEvalCaseStatus = 'pass' | 'skip' | 'fail';
export type SkillEvalRunnerMode = 'static' | 'live';
export type SkillEvalRunnerOutcome = 'pass' | 'skip' | 'fail';
export type SkillEvalRunnerErrorCode = 'unknown_runner' | 'unsafe_runner';

export interface RunSkillEvalsOptions {
  skill?: string;
  summaryPath?: string;
  dryRun?: boolean;
  force?: boolean;
  runnerId?: string;
  runner?: SkillEvalRunner;
}

export interface SkillEvalRunnerContext {
  rootDir: string;
  skillFilter?: string;
}

export interface SkillEvalRunnerResult {
  outcome: SkillEvalRunnerOutcome;
  executed: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

export interface SkillEvalRunner {
  name: string;
  mode: SkillEvalRunnerMode;
  run(
    fixture: SkillRegressionFixturePlan,
    context: SkillEvalRunnerContext
  ): SkillEvalRunnerResult | Promise<SkillEvalRunnerResult>;
}

export interface SkillEvalRunnerManifest {
  id: string;
  runnerName: string;
  mode: SkillEvalRunnerMode;
  enabled: boolean;
  safeByDefault: boolean;
  description: string;
}

export interface SkillEvalCaseRunnerResult extends SkillEvalRunnerResult {
  name: string;
  mode: SkillEvalRunnerMode;
}

export interface SkillEvalCaseResult {
  status: SkillEvalCaseStatus;
  skillName: string;
  name: string;
  path: string;
  reason: string;
  runner: SkillEvalCaseRunnerResult;
}

export interface SkillEvalFileResult {
  relativePath: string;
  path: string;
  action: KernelWriteAction;
}

export interface SkillEvalSummaryWriteResult extends SkillEvalFileResult {
  dryRun: boolean;
}

export interface SkillEvalResult {
  status: SkillEvalStatus;
  skillFilter?: string;
  runnerId: string;
  runner: {
    name: string;
    mode: SkillEvalRunnerMode;
  };
  fixtureCount: number;
  passCount: number;
  failCount: number;
  skipCount: number;
  warningCount: number;
  issues: SkillLintIssue[];
  results: SkillEvalCaseResult[];
  files: SkillEvalFileResult[];
  summary?: SkillEvalSummaryWriteResult;
}

const STATIC_RUNNER_ID = 'static';
const EVAL_RUNNER_MANIFESTS: SkillEvalRunnerManifest[] = [
  {
    id: STATIC_RUNNER_ID,
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
];

export class KernelEvalRunnerError extends Error {
  constructor(
    readonly code: SkillEvalRunnerErrorCode,
    readonly runnerId: string,
    message: string
  ) {
    super(message);
    this.name = 'KernelEvalRunnerError';
  }
}

export async function runSkillEvals(
  rootDir: string = process.cwd(),
  options: RunSkillEvalsOptions = {}
): Promise<SkillEvalResult> {
  const skillFilter = normalizeOptionalString(options.skill);
  const config = await loadKernelConfig(rootDir);
  const runnerId =
    options.runner === undefined
      ? normalizeRunnerId(options.runnerId ?? config.eval.default_runner)
      : normalizeOptionalString(options.runnerId) ?? 'injected';
  const runner = options.runner ?? resolveSkillEvalRunner(runnerId);
  const lintResult = await lintKernelSkills(rootDir, { config });
  const results: SkillEvalCaseResult[] = [];
  for (const fixture of lintResult.fixtures) {
    results.push(await evaluateFixture(rootDir, fixture, runner, skillFilter));
  }

  const failCount = results.filter((entry) => entry.status === 'fail').length;
  const result: SkillEvalResult = {
    status: getSkillEvalStatus(failCount, lintResult.warningCount),
    skillFilter: skillFilter ?? undefined,
    runnerId,
    runner: {
      name: runner.name,
      mode: runner.mode
    },
    fixtureCount: results.length,
    passCount: results.filter((entry) => entry.status === 'pass').length,
    failCount,
    skipCount: results.filter((entry) => entry.status === 'skip').length,
    warningCount: lintResult.warningCount,
    issues: lintResult.issues,
    results,
    files: []
  };

  const summaryPath = normalizeOptionalString(options.summaryPath);
  if (summaryPath !== null) {
    const writeResult = await writeKernelFile({
      targetPath: join(rootDir, summaryPath),
      content: renderSkillEvalSummary(result),
      dryRun: options.dryRun,
      force: options.force,
      preserveManualSections: true
    });

    const summaryFile = {
      relativePath: summaryPath.replace(/\\/g, '/'),
      path: writeResult.targetPath,
      action: writeResult.action
    };
    result.files = [summaryFile];
    result.summary = {
      ...summaryFile,
      dryRun: Boolean(options.dryRun)
    };
  }

  return result;
}

export function listSkillEvalRunnerManifests(): SkillEvalRunnerManifest[] {
  return EVAL_RUNNER_MANIFESTS.map((manifest) => ({ ...manifest }));
}

export function resolveSkillEvalRunner(runnerId: string | undefined = STATIC_RUNNER_ID): SkillEvalRunner {
  const normalizedRunnerId = normalizeRunnerId(runnerId);
  const manifest = EVAL_RUNNER_MANIFESTS.find((entry) => entry.id === normalizedRunnerId);

  if (manifest === undefined) {
    throw new KernelEvalRunnerError(
      'unknown_runner',
      normalizedRunnerId,
      `Unknown eval runner \`${normalizedRunnerId}\`. Available safe runners: ${getSafeRunnerIds().join(', ')}.`
    );
  }

  if (!manifest.enabled || !manifest.safeByDefault || manifest.mode !== 'static') {
    throw new KernelEvalRunnerError(
      'unsafe_runner',
      normalizedRunnerId,
      `Eval runner \`${normalizedRunnerId}\` is not enabled because it is not safe by default.`
    );
  }

  return createStaticSkillEvalRunner();
}

export function createStaticSkillEvalRunner(): SkillEvalRunner {
  return {
    name: 'static-noop',
    mode: 'static',
    run: (fixture) => {
      if (
        fixture.expectedActivates &&
        fixture.expectedSkills.length > 0 &&
        !fixture.expectedSkills.includes(fixture.skillName)
      ) {
        return {
          outcome: 'skip',
          executed: false,
          reason: `Expected skills do not include fixture skill \`${fixture.skillName}\`.`
        };
      }

      return {
        outcome: 'pass',
        executed: false,
        reason: 'Static fixture loaded; live ADE execution was not run.'
      };
    }
  };
}

export function formatSkillEvalResult(result: SkillEvalResult): string {
  const lines = [
    `Skill eval status: ${result.status}`,
    `Skill filter: ${result.skillFilter ?? 'all'}`,
    `Fixtures: ${result.fixtureCount}`,
    `Passed: ${result.passCount}`,
    ...(result.failCount > 0 ? [`Failed: ${result.failCount}`] : []),
    `Skipped: ${result.skipCount}`,
    `Warnings: ${result.warningCount}`
  ];

  for (const issue of result.issues) {
    lines.push(`${issue.severity} ${issue.code} ${issue.path} - ${issue.message}`);
  }

  for (const entry of result.results) {
    lines.push(`${entry.status} ${entry.path} - ${entry.reason}`);
  }

  for (const file of result.files) {
    lines.push(`${file.action}: ${file.relativePath}`);
  }

  return lines.join('\n');
}

export function formatSkillEvalJsonResult(result: SkillEvalResult): string {
  return formatKernelJsonResult(result);
}

export function renderSkillEvalSummary(result: SkillEvalResult): string {
  return [
    '# Skill Eval Summary',
    '',
    `Status: ${result.status}`,
    `Skill filter: ${result.skillFilter ?? 'all'}`,
    `Fixtures: ${result.fixtureCount}`,
    `Passed: ${result.passCount}`,
    ...(result.failCount > 0 ? [`Failed: ${result.failCount}`] : []),
    `Skipped: ${result.skipCount}`,
    `Warnings: ${result.warningCount}`,
    '',
    '## Results',
    '',
    '| Status | Skill | Fixture | Path | Reason |',
    '|---|---|---|---|---|',
    renderResultRows(result.results),
    '',
    '## Warnings',
    '',
    renderWarningRows(result.issues),
    '',
    '## Notes',
    '',
    `- Runner: ${result.runner.name} (${result.runner.mode}).`,
    '- This foundation does not execute prompts through a live ADE.',
    '- Static pass means the fixture was validated and evaluated by the no-op runner only.',
    ''
  ].join('\n');
}

async function evaluateFixture(
  rootDir: string,
  fixture: SkillRegressionFixturePlan,
  runner: SkillEvalRunner,
  skillFilter: string | null
): Promise<SkillEvalCaseResult> {
  if (skillFilter !== null && fixture.skillName !== skillFilter) {
    return {
      status: 'skip',
      skillName: fixture.skillName,
      name: fixture.name,
      path: fixture.path,
      reason: `Filtered out by --skill \`${skillFilter}\`.`,
      runner: {
        name: runner.name,
        mode: runner.mode,
        outcome: 'skip',
        executed: false,
        reason: `Filtered out by --skill \`${skillFilter}\`.`
      }
    };
  }

  const runnerResult = await runner.run(fixture, {
    rootDir,
    skillFilter: skillFilter ?? undefined
  });

  return {
    status: runnerResult.outcome,
    skillName: fixture.skillName,
    name: fixture.name,
    path: fixture.path,
    reason: runnerResult.reason,
    runner: {
      name: runner.name,
      mode: runner.mode,
      ...runnerResult
    }
  };
}

function renderResultRows(results: SkillEvalCaseResult[]): string {
  if (results.length === 0) {
    return '| skip | none | No validated fixtures |  | No fixtures were loaded. |';
  }

  return results
    .map((entry) =>
      [
        entry.status,
        entry.skillName,
        entry.name,
        entry.path,
        entry.reason
      ].map(escapeMarkdownTableCell)
    )
    .map((cells) => `| ${cells.join(' | ')} |`)
    .join('\n');
}

function renderWarningRows(issues: SkillLintIssue[]): string {
  if (issues.length === 0) {
    return '- None.';
  }

  return issues.map((issue) => `- ${issue.code} ${issue.path}: ${issue.message}`).join('\n');
}

function normalizeOptionalString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeRunnerId(value: string | undefined): string {
  return normalizeOptionalString(value) ?? STATIC_RUNNER_ID;
}

function getSafeRunnerIds(): string[] {
  return EVAL_RUNNER_MANIFESTS.filter(
    (manifest) => manifest.enabled && manifest.safeByDefault && manifest.mode === 'static'
  ).map((manifest) => manifest.id);
}

function getSkillEvalStatus(failCount: number, warningCount: number): SkillEvalStatus {
  if (failCount > 0) {
    return 'fail';
  }

  return warningCount > 0 ? 'warn' : 'pass';
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}
