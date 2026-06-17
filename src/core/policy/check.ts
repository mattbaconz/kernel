import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadKernelConfig } from '../config.js';
import { checkCiPolicy } from './ci.js';
import { classifyCommand, classifyPath, scanRepoCommands, scanRepoPaths } from './evaluate.js';
import { inferVerificationLevel, isVerificationSufficient, loadTaskContext, resolveEscalation } from './escalation.js';
import { hasPolicyFiles, loadPolicies } from './loader.js';
import type { PolicyGate } from './schema.js';
import type { PolicyCheckResult, PolicyViolation } from './types.js';

export interface PolicyCheckOptions {
  command?: string;
  path?: string;
  task?: string;
  ci?: boolean;
  strict?: boolean;
  rootDir?: string;
}

interface CommandsMap {
  scripts: Array<{ name: string; command: string; script: string }>;
}

interface RiskMap {
  highRiskPaths: Array<{ path: string; reason: string }>;
}

export async function checkPolicy(options: PolicyCheckOptions = {}): Promise<PolicyCheckResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const strict = Boolean(options.strict);
  const config = await loadKernelConfig(rootDir);
  const { policyGate, sourceFiles } = await loadPolicies(rootDir, config);
  const violations: PolicyViolation[] = [];

  if (!(await hasPolicyFiles(rootDir))) {
    violations.push({
      code: 'missing_policy_file',
      severity: 'warning',
      path: '.agent/policies/policy-gate.yaml',
      message: 'No policy files found; using built-in defaults merged with kernel.yaml risk settings.',
      policyClass: 'safe'
    });
  }

  if (options.command) {
    violations.push(...commandToViolations(classifyCommand(options.command, policyGate), options.command));
  }

  if (options.path) {
    violations.push(...pathToViolations(classifyPath(options.path, policyGate)));
  }

  if (!options.command && !options.path) {
    violations.push(...(await scanRepoViolations(rootDir, policyGate)));
  }

  if (options.task) {
    violations.push(...(await checkTaskEscalation(rootDir, policyGate, options.task)));
  }

  if (options.ci) {
    violations.push(...(await ciToViolations(rootDir, policyGate)));
  }

  return buildPolicyCheckResult(violations, strict, sourceFiles);
}

async function scanRepoViolations(rootDir: string, policy: PolicyGate): Promise<PolicyViolation[]> {
  const violations: PolicyViolation[] = [];
  const commandsMap = await readOptionalJson<CommandsMap>(join(rootDir, '.agent', 'maps', 'commands.json'));
  const riskMap = await readOptionalJson<RiskMap>(join(rootDir, '.agent', 'maps', 'risk.json'));

  if (commandsMap) {
    for (const classified of scanRepoCommands(commandsMap.scripts, policy)) {
      violations.push(...commandToViolations(classified, classified.command));
    }
  }

  const paths = riskMap?.highRiskPaths.map((entry) => entry.path) ?? [];
  for (const classified of scanRepoPaths(paths, policy)) {
    violations.push(...pathToViolations(classified));
  }

  return violations;
}

async function checkTaskEscalation(rootDir: string, policy: PolicyGate, task: string): Promise<PolicyViolation[]> {
  const taskContext = await loadTaskContext(rootDir, task);
  const requirement = resolveEscalation(policy, taskContext, taskContext.riskZones);
  const actual = inferVerificationLevel(taskContext);

  if (isVerificationSufficient(actual, requirement.minVerification)) {
    return [];
  }

  return [
    {
      code: 'insufficient_verification_level',
      severity: 'warning',
      path: `.agent/evidence/${taskContext.id}.md`,
      message: `Task ${taskContext.id} evidence is at ${actual} but policy requires ${requirement.minVerification}.`,
      policyClass: 'review'
    }
  ];
}

async function ciToViolations(rootDir: string, policy: PolicyGate): Promise<PolicyViolation[]> {
  const result = await checkCiPolicy(rootDir, policy);
  return result.missingChecks.map((check) => ({
    code: 'missing_ci_check',
    severity: 'warning',
    path: '.github/workflows',
    message: `CI workflow is missing required check command: ${check}`,
    policyClass: 'review'
  }));
}

function commandToViolations(classified: ReturnType<typeof classifyCommand>, subject: string): PolicyViolation[] {
  if (classified.policyClass === 'safe') {
    return [];
  }

  return [
    {
      code: classified.policyClass === 'block' ? 'policy_command_blocked' : 'policy_command_review',
      severity: classified.policyClass === 'block' ? 'error' : 'warning',
      path: subject,
      message: `${classified.policyClass} command: ${classified.reason}`,
      policyClass: classified.policyClass
    }
  ];
}

function pathToViolations(classified: ReturnType<typeof classifyPath>): PolicyViolation[] {
  if (classified.policyClass === 'safe') {
    return [];
  }

  return [
    {
      code: classified.policyClass === 'block' ? 'policy_path_block' : 'policy_path_review',
      severity: classified.policyClass === 'block' ? 'error' : 'warning',
      path: classified.path,
      message: `${classified.policyClass} path: ${classified.reason}`,
      policyClass: classified.policyClass
    }
  ];
}

function buildPolicyCheckResult(violations: PolicyViolation[], strict: boolean, sourceFiles: string[]): PolicyCheckResult {
  const sorted = [...violations].sort((left, right) => {
    return (
      left.code.localeCompare(right.code, 'en') ||
      left.path.localeCompare(right.path, 'en') ||
      left.message.localeCompare(right.message, 'en')
    );
  });

  const blockCount = sorted.filter((violation) => violation.policyClass === 'block').length;
  const reviewCount = sorted.filter((violation) => violation.policyClass === 'review').length;
  const warningCount = sorted.filter((violation) => violation.severity === 'warning').length;
  const errorCount = sorted.filter((violation) => violation.severity === 'error').length;
  const status = errorCount > 0 || (strict && warningCount > 0) ? 'fail' : warningCount > 0 ? 'warn' : 'pass';

  if (sourceFiles.length > 0 && sorted.length === 0) {
    return {
      status: 'pass',
      strict,
      blockCount: 0,
      reviewCount: 0,
      warningCount: 0,
      violations: sorted
    };
  }

  return {
    status,
    strict,
    blockCount,
    reviewCount,
    warningCount,
    violations: sorted
  };
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function formatPolicyCheckResult(result: PolicyCheckResult): string {
  const lines = [
    `Policy status: ${result.status}`,
    `Blocks: ${result.blockCount}`,
    `Reviews: ${result.reviewCount}`,
    `Warnings: ${result.warningCount}`
  ];

  for (const violation of result.violations) {
    lines.push(`${violation.severity} ${violation.code} ${violation.path} - ${violation.message}`);
  }

  return lines.join('\n');
}

export function formatPolicyCheckJsonResult(result: PolicyCheckResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
