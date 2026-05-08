import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { loadKernelConfig, type KernelConfig } from './config.js';
import { formatKernelJsonResult } from './json-output.js';
import { resolveCanonicalPaths } from './paths.js';

export type SkillLintStatus = 'pass' | 'warn' | 'fail';
export type SkillLintIssueCode =
  | 'invalid_skill_fixture'
  | 'invalid_skill_frontmatter'
  | 'missing_do_not_use_condition'
  | 'missing_output_artifact'
  | 'missing_skill_description'
  | 'missing_skill_file'
  | 'missing_skill_frontmatter'
  | 'missing_skill_name'
  | 'missing_skill_section'
  | 'missing_trigger_description'
  | 'overbroad_skill_description'
  | 'skill_fixture_without_skill'
  | 'skill_heading_mismatch'
  | 'skill_name_mismatch';

export interface SkillLintOptions {
  strict?: boolean;
  config?: KernelConfig;
}

export interface SkillLintIssue {
  code: SkillLintIssueCode;
  severity: 'warning';
  path: string;
  message: string;
}

export interface SkillRegressionFixturePlan {
  path: string;
  skillName: string;
  name: string;
  prompt: string;
  expectedActivates: boolean;
  expectedSkills: string[];
}

export interface SkillLintResult {
  status: SkillLintStatus;
  strict: boolean;
  skillCount: number;
  fixtureCount: number;
  warningCount: number;
  issues: SkillLintIssue[];
  fixtures: SkillRegressionFixturePlan[];
}

interface SkillFile {
  directoryName: string;
  path: string;
  relativePath: string;
}

interface ParsedSkillDocument {
  frontmatter: Record<string, unknown> | null;
  frontmatterInvalid: boolean;
  body: string;
}

export async function lintKernelSkills(
  rootDir: string = process.cwd(),
  options: SkillLintOptions = {}
): Promise<SkillLintResult> {
  const strict = Boolean(options.strict);
  const config = options.config ?? (await loadKernelConfig(rootDir));
  const canonicalPaths = resolveCanonicalPaths(rootDir, config);
  const issues: SkillLintIssue[] = [];
  const skillFiles = await discoverSkillFiles(rootDir, canonicalPaths.skillsDir, issues);
  const skillNames = new Set(skillFiles.map((file) => file.directoryName));

  for (const skillFile of skillFiles) {
    const content = await readFile(skillFile.path, 'utf8');
    lintSkillFile(skillFile, content, issues);
  }

  const fixtures = await discoverSkillRegressionFixtures(rootDir, config, skillNames, issues);
  const sortedIssues = [...issues].sort(compareIssues);
  const warningCount = sortedIssues.length;

  return {
    status: getSkillLintStatus(warningCount, strict),
    strict,
    skillCount: skillFiles.length,
    fixtureCount: fixtures.length,
    warningCount,
    issues: sortedIssues,
    fixtures
  };
}

export function formatSkillLintResult(result: SkillLintResult): string {
  const lines = [
    `Skill lint status: ${result.status}`,
    `Skills: ${result.skillCount}`,
    `Fixtures: ${result.fixtureCount}`,
    `Warnings: ${result.warningCount}`
  ];

  for (const issue of result.issues) {
    lines.push(`${issue.severity} ${issue.code} ${issue.path} - ${issue.message}`);
  }

  return lines.join('\n');
}

export function formatSkillLintJsonResult(result: SkillLintResult): string {
  return formatKernelJsonResult(result);
}

async function discoverSkillFiles(
  rootDir: string,
  skillsDir: string,
  issues: SkillLintIssue[]
): Promise<SkillFile[]> {
  const entries = await readDirectory(skillsDir);
  if (entries === null) {
    return [];
  }

  const skillFiles: SkillFile[] = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => compareStrings(left.name, right.name))) {
    const path = join(skillsDir, entry.name, 'SKILL.md');
    const relativePath = toRelativePath(rootDir, path);

    if (!(await pathExists(path))) {
      issues.push({
        code: 'missing_skill_file',
        severity: 'warning',
        path: relativePath,
        message: `Canonical skill directory \`${entry.name}\` must contain SKILL.md.`
      });
      continue;
    }

    skillFiles.push({
      directoryName: entry.name,
      path,
      relativePath
    });
  }

  return skillFiles;
}

function lintSkillFile(skillFile: SkillFile, content: string, issues: SkillLintIssue[]): void {
  const parsed = parseSkillDocument(content);

  if (parsed.frontmatterInvalid) {
    issues.push({
      code: 'invalid_skill_frontmatter',
      severity: 'warning',
      path: skillFile.relativePath,
      message: 'Skill YAML frontmatter could not be parsed.'
    });
  }

  if (parsed.frontmatter === null) {
    issues.push({
      code: 'missing_skill_frontmatter',
      severity: 'warning',
      path: skillFile.relativePath,
      message: 'Skill file must start with YAML frontmatter containing `name` and `description`.'
    });
  } else {
    lintSkillMetadata(skillFile, parsed.frontmatter, parsed.body, issues);
  }

  lintRequiredSections(skillFile, parsed.body, issues);
}

function lintSkillMetadata(
  skillFile: SkillFile,
  frontmatter: Record<string, unknown>,
  body: string,
  issues: SkillLintIssue[]
): void {
  const name = getNonEmptyString(frontmatter.name);
  const description = getNonEmptyString(frontmatter.description);

  if (name === null) {
    issues.push({
      code: 'missing_skill_name',
      severity: 'warning',
      path: skillFile.relativePath,
      message: 'Skill frontmatter must include non-empty `name`.'
    });
  } else {
    if (name !== skillFile.directoryName) {
      issues.push({
        code: 'skill_name_mismatch',
        severity: 'warning',
        path: skillFile.relativePath,
        message: `Skill frontmatter name \`${name}\` must match directory name \`${skillFile.directoryName}\`.`
      });
    }

    const heading = getH1(body);
    if (heading !== null && heading !== name) {
      issues.push({
        code: 'skill_heading_mismatch',
        severity: 'warning',
        path: skillFile.relativePath,
        message: `Skill H1 \`${heading}\` must match frontmatter name \`${name}\`.`
      });
    }
  }

  if (description === null) {
    issues.push({
      code: 'missing_skill_description',
      severity: 'warning',
      path: skillFile.relativePath,
      message: 'Skill frontmatter must include non-empty `description`.'
    });
    return;
  }

  lintSkillDescription(skillFile, description, issues);
}

function lintSkillDescription(skillFile: SkillFile, description: string, issues: SkillLintIssue[]): void {
  if (!/\bUse (when|before|after|for)\b/i.test(description)) {
    issues.push({
      code: 'missing_trigger_description',
      severity: 'warning',
      path: skillFile.relativePath,
      message: 'Skill description must describe an activation trigger with `Use when`, `Use before`, `Use after`, or `Use for`.'
    });
  }

  if (!/\b(Do not use|Do not trigger|unless)\b/i.test(description)) {
    issues.push({
      code: 'missing_do_not_use_condition',
      severity: 'warning',
      path: skillFile.relativePath,
      message: 'Skill description must include a do-not-use boundary such as `Do not use`, `Do not trigger`, or `unless`.'
    });
  }

  if (/\b(anything|everything|all tasks)\b/i.test(description)) {
    issues.push({
      code: 'overbroad_skill_description',
      severity: 'warning',
      path: skillFile.relativePath,
      message: 'Skill description is overbroad; avoid words such as `anything`, `everything`, or `all tasks`.'
    });
  }
}

function lintRequiredSections(skillFile: SkillFile, body: string, issues: SkillLintIssue[]): void {
  for (const section of ['Purpose', 'Output']) {
    if (!hasSection(body, section)) {
      issues.push({
        code: 'missing_skill_section',
        severity: 'warning',
        path: skillFile.relativePath,
        message: `Skill file must include a \`## ${section}\` section.`
      });
    }
  }

  if (!hasSection(body, 'Workflow') && !hasSection(body, 'Procedure')) {
    issues.push({
      code: 'missing_skill_section',
      severity: 'warning',
      path: skillFile.relativePath,
      message: 'Skill file must include a `## Workflow` or `## Procedure` section.'
    });
  }

  const outputSection = getSectionContent(body, 'Output');
  if (outputSection !== null && !/\.agent\//i.test(outputSection) && !/\bno artifact\b/i.test(outputSection)) {
    issues.push({
      code: 'missing_output_artifact',
      severity: 'warning',
      path: skillFile.relativePath,
      message: 'Skill output section should name a concrete `.agent/` artifact or state that no artifact is produced.'
    });
  }
}

async function discoverSkillRegressionFixtures(
  rootDir: string,
  config: KernelConfig,
  skillNames: Set<string>,
  issues: SkillLintIssue[]
): Promise<SkillRegressionFixturePlan[]> {
  const fixturesDir = join(rootDir, config.canonical.agent_dir, 'evals', 'skills');
  const skillFixtureDirs = await readDirectory(fixturesDir);
  if (skillFixtureDirs === null) {
    return [];
  }

  const fixtures: SkillRegressionFixturePlan[] = [];
  for (const skillDir of skillFixtureDirs.filter((entry) => entry.isDirectory()).sort((left, right) => compareStrings(left.name, right.name))) {
    const fixtureFiles = await readDirectory(join(fixturesDir, skillDir.name));
    if (fixtureFiles === null) {
      continue;
    }

    for (const fixtureFile of fixtureFiles
      .filter((entry) => entry.isFile() && /\.(ya?ml)$/i.test(entry.name))
      .sort((left, right) => compareStrings(left.name, right.name))) {
      const path = join(fixturesDir, skillDir.name, fixtureFile.name);
      const relativePath = toRelativePath(rootDir, path);

      if (!skillNames.has(skillDir.name)) {
        issues.push({
          code: 'skill_fixture_without_skill',
          severity: 'warning',
          path: relativePath,
          message: `Skill regression fixture references missing canonical skill \`${skillDir.name}\`.`
        });
        continue;
      }

      const fixture = await parseSkillRegressionFixture(path, relativePath, skillDir.name, issues);
      if (fixture !== null) {
        fixtures.push(fixture);
      }
    }
  }

  return fixtures.sort((left, right) => compareStrings(left.path, right.path));
}

async function parseSkillRegressionFixture(
  path: string,
  relativePath: string,
  skillName: string,
  issues: SkillLintIssue[]
): Promise<SkillRegressionFixturePlan | null> {
  let parsed: unknown;
  try {
    parsed = parseYaml(await readFile(path, 'utf8'));
  } catch {
    addInvalidFixtureIssue(relativePath, issues);
    return null;
  }

  if (!isRecord(parsed) || !isValidFixture(parsed)) {
    addInvalidFixtureIssue(relativePath, issues);
    return null;
  }

  const expected = parsed.expected;
  const expectedSkills = Array.isArray(expected.skills)
    ? expected.skills.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];

  return {
    path: relativePath,
    skillName,
    name: parsed.name,
    prompt: parsed.prompt,
    expectedActivates: expected.activates,
    expectedSkills
  };
}

function addInvalidFixtureIssue(path: string, issues: SkillLintIssue[]): void {
  issues.push({
    code: 'invalid_skill_fixture',
    severity: 'warning',
    path,
    message: 'Skill regression fixture must include `name`, `prompt`, and `expected.activates`.'
  });
}

function parseSkillDocument(content: string): ParsedSkillDocument {
  const match = /^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---\r?\n?(?<body>[\s\S]*)$/u.exec(content);
  if (!match?.groups) {
    return {
      frontmatter: null,
      frontmatterInvalid: false,
      body: content
    };
  }

  try {
    const parsed = parseYaml(match.groups.frontmatter);
    return {
      frontmatter: isRecord(parsed) ? parsed : {},
      frontmatterInvalid: false,
      body: match.groups.body
    };
  } catch {
    return {
      frontmatter: {},
      frontmatterInvalid: true,
      body: match.groups.body
    };
  }
}

function hasSection(body: string, section: string): boolean {
  return new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, 'im').test(body);
}

function getSectionContent(body: string, section: string): string | null {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, 'i').test(line));
  if (start === -1) {
    return null;
  }

  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
}

function getH1(body: string): string | null {
  const match = /^#\s+(.+?)\s*$/m.exec(body);
  return match?.[1] ?? null;
}

function isValidFixture(value: Record<string, unknown>): value is {
  name: string;
  prompt: string;
  expected: {
    activates: boolean;
    skills?: unknown[];
  };
} {
  return (
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.prompt === 'string' &&
    value.prompt.trim().length > 0 &&
    isRecord(value.expected) &&
    typeof value.expected.activates === 'boolean'
  );
}

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function readDirectory(path: string): Promise<import('node:fs').Dirent[] | null> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
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

function getSkillLintStatus(warningCount: number, strict: boolean): SkillLintStatus {
  if (warningCount === 0) {
    return 'pass';
  }

  return strict ? 'fail' : 'warn';
}

function compareIssues(left: SkillLintIssue, right: SkillLintIssue): number {
  return (
    compareStrings(left.code, right.code) ||
    compareStrings(left.path, right.path) ||
    compareStrings(left.message, right.message)
  );
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function toRelativePath(rootDir: string, path: string): string {
  return relative(rootDir, path).replace(/\\/g, '/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
