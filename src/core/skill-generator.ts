import { access, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { loadKernelConfig, SKILL_GENERATION_SETS, type SkillGenerationSet } from './config.js';
import { KernelFileExistsError, type KernelWriteAction, writeKernelFile } from './fs.js';
import { MANUAL_END, MANUAL_START } from './manual-sections.js';

export const MVP_SKILL_NAMES = [
  'adapter-compiler',
  'evidence-ledger',
  'handoff-packet',
  'kernel-core',
  'task-contract',
  'verify-lattice'
] as const;

export type MvpSkillName = (typeof MVP_SKILL_NAMES)[number];

export interface GenerateCanonicalSkillsOptions {
  docsVaultDir?: string;
  dryRun?: boolean;
  force?: boolean;
  set?: string;
}

export interface GeneratedSkillFileResult {
  relativePath: string;
  path: string;
  action: KernelWriteAction;
}

export type SkippedSkillDocReasonCode =
  | 'invalid_skill_filename'
  | 'missing_output_artifact'
  | 'missing_skill_output'
  | 'missing_skill_purpose'
  | 'missing_skill_trigger'
  | 'missing_skill_workflow'
  | 'missing_trigger_boundary'
  | 'overbroad_skill_trigger'
  | 'skill_heading_mismatch';

export interface SkippedSkillDocReason {
  code: SkippedSkillDocReasonCode;
  message: string;
}

export interface SkippedSkillDocResult {
  skillName: string;
  relativePath: string;
  reasons: SkippedSkillDocReason[];
}

export interface GenerateCanonicalSkillsResult {
  generationSet: SkillGenerationSet;
  dryRun: boolean;
  skills: readonly string[];
  files: GeneratedSkillFileResult[];
  skipped: SkippedSkillDocResult[];
}

interface SkillWritePlan {
  skillName: string;
  relativePath: string;
  targetPath: string;
  content: string;
}

interface SkillGenerationPlan {
  generationSet: SkillGenerationSet;
  files: SkillWritePlan[];
  skipped: SkippedSkillDocResult[];
}

interface ResolvedSkillDocs {
  skillNames: string[];
  skipped: SkippedSkillDocResult[];
}

const DEFAULT_DOCS_VAULT_DIR = 'kernel_obsidian_vault';
const SKILL_DOCS_DIR = '03-skills';
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export async function generateCanonicalSkills(
  rootDir: string = process.cwd(),
  options: GenerateCanonicalSkillsOptions = {}
): Promise<GenerateCanonicalSkillsResult> {
  const plan = await createSkillGenerationPlan(rootDir, options);

  if (!options.force && !options.dryRun) {
    await assertNoExistingTargets(plan.files);
  }

  const files: GeneratedSkillFileResult[] = [];
  for (const filePlan of plan.files) {
    const result = await writeKernelFile({
      targetPath: filePlan.targetPath,
      content: filePlan.content,
      dryRun: options.dryRun,
      force: options.force,
      preserveManualSections: true
    });

    files.push({
      relativePath: filePlan.relativePath,
      path: result.targetPath,
      action: result.action
    });
  }

  return {
    generationSet: plan.generationSet,
    dryRun: Boolean(options.dryRun),
    skills: plan.files.map((filePlan) => filePlan.skillName),
    files,
    skipped: plan.skipped
  };
}

async function createSkillGenerationPlan(
  rootDir: string,
  options: GenerateCanonicalSkillsOptions
): Promise<SkillGenerationPlan> {
  const config = await loadKernelConfig(rootDir);
  const docsVaultPath = resolve(rootDir, options.docsVaultDir ?? DEFAULT_DOCS_VAULT_DIR);
  const set = resolveGenerationSet(options.set, config.skills.generated_set);
  const resolvedDocs = await resolveSkillDocs(docsVaultPath, set);

  const files: SkillWritePlan[] = [];
  for (const skillName of resolvedDocs.skillNames) {
    const sourcePath = join(docsVaultPath, SKILL_DOCS_DIR, `${skillName}.md`);
    const sourceContent = await readFile(sourcePath, 'utf8');
    const relativePath = joinRelative(config.canonical.skills_dir, skillName, 'SKILL.md');
    files.push({
      skillName,
      relativePath,
      targetPath: join(rootDir, relativePath),
      content: renderCanonicalSkill(skillName, sourceContent)
    });
  }

  return {
    generationSet: set,
    files,
    skipped: resolvedDocs.skipped
  };
}

async function resolveSkillDocs(docsVaultPath: string, set: SkillGenerationSet): Promise<ResolvedSkillDocs> {
  if (set === 'mvp') {
    return {
      skillNames: [...MVP_SKILL_NAMES],
      skipped: []
    };
  }

  const docsDir = join(docsVaultPath, SKILL_DOCS_DIR);
  const entries = await readdir(docsDir, { withFileTypes: true });
  const skillNames: string[] = [];
  const skipped: SkippedSkillDocResult[] = [];

  for (const entry of entries
    .filter((item) => item.isFile() && item.name.toLowerCase().endsWith('.md'))
    .sort((left, right) => compareStrings(left.name, right.name))) {
    const skillName = entry.name.slice(0, -'.md'.length);
    const relativePath = joinRelative(SKILL_DOCS_DIR, entry.name);
    if (!SKILL_NAME_PATTERN.test(skillName)) {
      skipped.push({
        skillName,
        relativePath,
        reasons: [
          {
            code: 'invalid_skill_filename',
            message: 'Skill doc filename must be lowercase kebab-case Markdown.'
          }
        ]
      });
      continue;
    }

    const sourceContent = await readFile(join(docsDir, entry.name), 'utf8');
    const skippedReasons = getSkippedSkillDocReasons(skillName, sourceContent);
    if (skippedReasons.length === 0) {
      skillNames.push(skillName);
    } else {
      skipped.push({
        skillName,
        relativePath,
        reasons: skippedReasons
      });
    }
  }

  return {
    skillNames,
    skipped
  };
}

function renderCanonicalSkill(skillName: string, sourceContent: string): string {
  const body = normalizeSkillDocumentation(sourceContent);
  const description = deriveDescription(body);
  const frontmatter = ['---', `name: ${skillName}`, `description: ${JSON.stringify(description)}`, '---', ''].join('\n');
  const content = `${frontmatter}${body}`;

  if (content.includes(MANUAL_START) && content.includes(MANUAL_END)) {
    return normalizeTrailingNewline(content);
  }

  return [
    content.trimEnd(),
    '',
    '## Manual notes',
    '',
    MANUAL_START,
    '',
    MANUAL_END,
    ''
  ].join('\n');
}

function normalizeSkillDocumentation(sourceContent: string): string {
  return normalizeTrailingNewline(stripYamlFrontmatter(sourceContent));
}

function deriveDescription(body: string): string {
  const purpose = getSectionContent(body, 'Purpose') ?? 'Use when the Kernel skill matches the current task.';
  const firstParagraph = purpose
    .split(/\r?\n\s*\r?\n/u)[0]
    .replace(/\s+/gu, ' ')
    .trim();
  const trigger = firstParagraph.length > 0 ? firstParagraph : 'Use when the Kernel skill matches the current task.';

  if (/\b(Do not use|Do not trigger|unless)\b/i.test(trigger)) {
    return trigger;
  }

  return `${trigger} Do not trigger it for unrelated work just because the skill exists.`;
}

function getSkippedSkillDocReasons(skillName: string, sourceContent: string): SkippedSkillDocReason[] {
  const body = normalizeSkillDocumentation(sourceContent);
  const description = deriveDescription(body);
  const heading = getH1(body);
  const output = getSectionContent(body, 'Output');
  const reasons: SkippedSkillDocReason[] = [];

  if (heading !== skillName) {
    reasons.push({
      code: 'skill_heading_mismatch',
      message: 'Skill doc H1 heading must match the filename-derived skill name.'
    });
  }

  if (!hasSection(body, 'Purpose')) {
    reasons.push({
      code: 'missing_skill_purpose',
      message: 'Skill doc must include a `## Purpose` section.'
    });
  }

  if (!hasSection(body, 'Output')) {
    reasons.push({
      code: 'missing_skill_output',
      message: 'Skill doc must include a `## Output` section.'
    });
  }

  if (!hasSection(body, 'Workflow') && !hasSection(body, 'Procedure')) {
    reasons.push({
      code: 'missing_skill_workflow',
      message: 'Skill doc must include a `## Workflow` or `## Procedure` section.'
    });
  }

  if (!/\bUse (when|before|after|for)\b/i.test(description)) {
    reasons.push({
      code: 'missing_skill_trigger',
      message: 'Skill doc purpose must derive a trigger using `Use when`, `Use before`, `Use after`, or `Use for`.'
    });
  }

  if (!/\b(Do not use|Do not trigger|unless)\b/i.test(description)) {
    reasons.push({
      code: 'missing_trigger_boundary',
      message: 'Skill doc purpose must derive a do-not-use boundary.'
    });
  }

  if (/\b(anything|everything|all tasks)\b/i.test(description)) {
    reasons.push({
      code: 'overbroad_skill_trigger',
      message: 'Skill doc purpose must avoid overbroad trigger language.'
    });
  }

  if (output !== null && !/\.agent\//i.test(output) && !/\bno artifact\b/i.test(output)) {
    reasons.push({
      code: 'missing_output_artifact',
      message: 'Skill doc output must mention a `.agent/` artifact or state that no artifact is produced.'
    });
  }

  return reasons;
}

function resolveGenerationSet(requestedSet: string | undefined, configuredSet: SkillGenerationSet): SkillGenerationSet {
  if (requestedSet === undefined) {
    return configuredSet;
  }

  if (isSkillGenerationSet(requestedSet)) {
    return requestedSet;
  }

  throw new KernelSkillGenerationSetError(requestedSet);
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

function hasSection(body: string, section: string): boolean {
  return new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, 'im').test(body);
}

function getH1(body: string): string | null {
  const match = /^#\s+(.+?)\s*$/m.exec(body);
  return match?.[1] ?? null;
}

function stripYamlFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, '');
}

async function assertNoExistingTargets(plans: SkillWritePlan[]): Promise<void> {
  for (const plan of plans) {
    if (await pathExists(plan.targetPath)) {
      throw new KernelFileExistsError(plan.targetPath);
    }
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

function normalizeTrailingNewline(content: string): string {
  return `${content.trimEnd()}\n`;
}

function joinRelative(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split(/[\\/]+/))
    .filter(Boolean)
    .join('/');
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function isSkillGenerationSet(value: string): value is SkillGenerationSet {
  return SKILL_GENERATION_SETS.includes(value as SkillGenerationSet);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export class KernelSkillGenerationSetError extends Error {
  constructor(readonly set: string) {
    super(`Unknown skill generation set \`${set}\`. Expected one of: ${SKILL_GENERATION_SETS.join(', ')}.`);
    this.name = 'KernelSkillGenerationSetError';
  }
}
