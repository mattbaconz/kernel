import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getAdapter } from '../adapters/index.js';
import { loadCanonicalSkills } from '../adapters/canonical-skills.js';
import type { KernelAdapter } from '../adapters/types.js';
import { renderGeneratedAdapterFile } from './adapter-compiler.js';
import { KernelConfigError, loadKernelConfig, type KernelConfig } from './config.js';
import { INIT_DIRECTORIES } from './init.js';
import { formatKernelJsonResult } from './json-output.js';
import { GENERATED_FILE_HEADER } from './manual-sections.js';
import { lintKernelSkills, type SkillLintIssueCode } from './skills.js';
import { checkPolicy } from './policy/check.js';
import { hasPolicyFiles } from './policy/loader.js';

export type ValidationSeverity = 'error' | 'warning';
export type ValidationStatus = 'pass' | 'warn' | 'fail';

export interface ValidateKernelOptions {
  strict?: boolean;
  throwConfigErrors?: boolean;
}

export interface ValidationIssue {
  code:
    | 'invalid_config'
    | 'missing_required_directory'
    | 'missing_map_file'
    | 'stale_map_version'
    | 'missing_generated_header'
    | 'missing_evidence_for_current_task'
    | 'missing_adapter_output'
    | 'stale_generated_file'
    | 'missing_policy_file'
    | 'policy_command_blocked'
    | 'policy_path_review_required'
    | 'insufficient_verification_level'
    | 'missing_ci_check'
    | SkillLintIssueCode;
  severity: ValidationSeverity;
  path: string;
  message: string;
}

export interface ValidationResult {
  status: ValidationStatus;
  strict: boolean;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
}

const REQUIRED_MAP_FILES = ['repo.json', 'commands.json', 'tests.json', 'risk.json'] as const;
const ADAPTER_TARGETS = [
  'codex',
  'claude',
  'cursor',
  'kiro',
  'github-copilot',
  'gemini',
  'zed',
  'opencode',
  'windsurf',
  'junie'
] as const;

export async function validateKernel(
  rootDir: string = process.cwd(),
  options: ValidateKernelOptions = {}
): Promise<ValidationResult> {
  const strict = Boolean(options.strict);
  const issues: ValidationIssue[] = [];

  let config: KernelConfig;
  try {
    config = await loadKernelConfig(rootDir);
  } catch (error) {
    if (error instanceof KernelConfigError) {
      if (options.throwConfigErrors) {
        throw error;
      }

      return buildValidationResult(
        [
          {
            code: 'invalid_config',
            severity: 'error',
            path: '.agent/kernel.yaml',
            message: error.message
          }
        ],
        strict
      );
    }
    throw error;
  }

  issues.push(...(await validateRequiredDirectories(rootDir)));
  issues.push(...(await validateMapSet(rootDir)));
  issues.push(...(await validateMapVersions(rootDir, config)));
  issues.push(...(await validateAdapterOutputs(rootDir, config, getEnabledAdapters(config))));
  issues.push(...(await validateSkills(rootDir, config)));
  issues.push(...(await validateCurrentTaskEvidence(rootDir)));
  issues.push(...(await validatePolicies(rootDir, strict)));

  return buildValidationResult(issues, strict);
}

async function validateSkills(rootDir: string, config: KernelConfig): Promise<ValidationIssue[]> {
  const result = await lintKernelSkills(rootDir, { config });
  return result.issues;
}

export function formatValidationResult(result: ValidationResult): string {
  const lines = [
    `Validation status: ${result.status}`,
    `Errors: ${result.errorCount}`,
    `Warnings: ${result.warningCount}`
  ];

  for (const issue of result.issues) {
    lines.push(`${issue.severity} ${issue.code} ${issue.path} - ${issue.message}`);
  }

  return lines.join('\n');
}

export function formatValidationJsonResult(result: ValidationResult): string {
  return formatKernelJsonResult(result);
}

async function validateRequiredDirectories(rootDir: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  for (const relativePath of INIT_DIRECTORIES) {
    if (!(await pathExists(join(rootDir, relativePath)))) {
      issues.push({
        code: 'missing_required_directory',
        severity: 'error',
        path: relativePath,
        message: `Required Kernel directory is missing: ${relativePath}.`
      });
    }
  }

  return issues;
}

async function validateMapVersions(rootDir: string, config: KernelConfig): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const mapsDir = join(rootDir, config.canonical.maps_dir);

  for (const file of REQUIRED_MAP_FILES) {
    const mapPath = join(mapsDir, file);
    if (!(await pathExists(mapPath))) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(mapPath, 'utf8'));
    } catch {
      continue;
    }

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      (parsed as { version: unknown }).version === 1
    ) {
      issues.push({
        code: 'stale_map_version',
        severity: 'warning',
        path: joinRelative(config.canonical.maps_dir, file),
        message: `Map file is version 1; regenerate with \`kernel map --force\` to upgrade to version 2.`
      });
    }
  }

  return issues;
}

function joinRelative(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split(/[\\/]+/))
    .filter(Boolean)
    .join('/');
}

async function validateMapSet(rootDir: string): Promise<ValidationIssue[]> {
  const existing = new Set<string>();

  for (const file of REQUIRED_MAP_FILES) {
    if (await pathExists(join(rootDir, '.agent', 'maps', file))) {
      existing.add(file);
    }
  }

  if (existing.size === 0 || existing.size === REQUIRED_MAP_FILES.length) {
    return [];
  }

  const anchor = [...existing].sort(compareStrings)[0];
  return REQUIRED_MAP_FILES.filter((file) => !existing.has(file)).map((file) => ({
    code: 'missing_map_file',
    severity: 'warning',
    path: `.agent/maps/${file}`,
    message: `Map set is incomplete because \`${anchor}\` is present but \`${file}\` is missing.`
  }));
}

async function validateAdapterOutputs(
  rootDir: string,
  config: KernelConfig,
  adapters: KernelAdapter[]
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const canonicalSkills = await loadCanonicalSkills(rootDir, config);

  for (const adapter of adapters) {
    const outputs = adapter.render({ config, canonicalSkills });
    for (const output of outputs) {
      const absolutePath = join(rootDir, output.path);
      if (!(await pathExists(absolutePath))) {
        issues.push({
          code: 'missing_adapter_output',
          severity: 'warning',
          path: output.path,
          message: `Enabled adapter \`${adapter.name}\` is missing generated output \`${output.path}\`.`
        });
        continue;
      }

      const content = await readFile(absolutePath, 'utf8');
      if (!content.startsWith(GENERATED_FILE_HEADER)) {
        issues.push({
          code: 'missing_generated_header',
          severity: 'warning',
          path: output.path,
          message: 'Generated adapter output is missing the Kernel generated header.'
        });
        continue;
      }

      const expected = output.generated
        ? renderGeneratedAdapterFile(output.content, output.preserveManualSections ? content : undefined)
        : output.content;
      if (content !== expected) {
        issues.push({
          code: 'stale_generated_file',
          severity: 'warning',
          path: output.path,
          message: 'Generated adapter output differs from the current Kernel renderer output.'
        });
      }
    }
  }

  return issues;
}

function getEnabledAdapters(config: KernelConfig): KernelAdapter[] {
  return ADAPTER_TARGETS.filter((target) => {
    if (target === 'github-copilot') {
      return config.adapters.github_copilot;
    }

    return config.adapters[target as keyof typeof config.adapters];
  }).map((target) => getAdapter(target));
}

async function validatePolicies(rootDir: string, strict: boolean): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  if (!(await hasPolicyFiles(rootDir))) {
    issues.push({
      code: 'missing_policy_file',
      severity: 'warning',
      path: '.agent/policies/policy-gate.yaml',
      message: 'No policy files found in .agent/policies/.'
    });
  }

  const hasCurrentTask = await pathExists(join(rootDir, '.agent', 'state', 'current-task.md'));
  const policyResult = await checkPolicy({
    rootDir,
    strict,
    ci: true,
    task: hasCurrentTask ? 'current' : undefined
  });

  for (const violation of policyResult.violations) {
    if (violation.code === 'missing_policy_file') {
      continue;
    }

    const code = mapPolicyViolationCode(violation.code);
    if (!code) {
      continue;
    }

    issues.push({
      code,
      severity: getPolicyIssueSeverity(violation, strict),
      path: violation.path,
      message: violation.message
    });
  }

  return issues;
}

function mapPolicyViolationCode(
  code: string
):
  | 'policy_command_blocked'
  | 'policy_path_review_required'
  | 'insufficient_verification_level'
  | 'missing_ci_check'
  | null {
  if (code === 'policy_command_blocked') {
    return 'policy_command_blocked';
  }
  if (code === 'policy_path_review' || code === 'policy_path_block') {
    return 'policy_path_review_required';
  }
  if (code === 'insufficient_verification_level') {
    return 'insufficient_verification_level';
  }
  if (code === 'missing_ci_check') {
    return 'missing_ci_check';
  }
  return null;
}

function getPolicyIssueSeverity(
  violation: { code: string; severity: 'error' | 'warning'; policyClass: string },
  strict: boolean
): ValidationSeverity {
  if (violation.code === 'policy_command_blocked' || violation.code === 'policy_path_block') {
    return strict ? 'error' : 'warning';
  }
  if (violation.code === 'policy_command_review' && violation.policyClass === 'block') {
    return strict ? 'error' : 'warning';
  }
  return 'warning';
}

async function validateCurrentTaskEvidence(rootDir: string): Promise<ValidationIssue[]> {
  const currentTaskPath = join(rootDir, '.agent', 'state', 'current-task.md');
  if (!(await pathExists(currentTaskPath))) {
    return [];
  }

  const currentTask = await readFile(currentTaskPath, 'utf8');
  const match = /^# Task Contract:\s*(.+?)\s*$/m.exec(currentTask);
  if (!match?.[1]) {
    return [];
  }

  const taskId = normalizeTaskId(match[1]);
  const evidencePath = `.agent/evidence/${taskId}.md`;
  if (await pathExists(join(rootDir, evidencePath))) {
    return [];
  }

  return [
    {
      code: 'missing_evidence_for_current_task',
      severity: 'warning',
      path: evidencePath,
      message: `Current task \`${taskId}\` does not have a matching evidence ledger.`
    }
  ];
}

function buildValidationResult(issues: ValidationIssue[], strict: boolean): ValidationResult {
  const sortedIssues = [...issues].sort(compareIssues);
  const errorCount = sortedIssues.filter((issue) => issue.severity === 'error').length;
  const warningCount = sortedIssues.filter((issue) => issue.severity === 'warning').length;
  const status = getValidationStatus(errorCount, warningCount, strict);

  return {
    status,
    strict,
    errorCount,
    warningCount,
    issues: sortedIssues
  };
}

function getValidationStatus(errorCount: number, warningCount: number, strict: boolean): ValidationStatus {
  if (errorCount > 0 || (strict && warningCount > 0)) {
    return 'fail';
  }
  if (warningCount > 0) {
    return 'warn';
  }

  return 'pass';
}

function compareIssues(left: ValidationIssue, right: ValidationIssue): number {
  return (
    compareStrings(left.code, right.code) ||
    compareStrings(left.path, right.path) ||
    compareStrings(left.message, right.message)
  );
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function normalizeTaskId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
