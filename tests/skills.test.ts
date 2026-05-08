import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { formatSkillLintJsonResult, formatSkillLintResult, lintKernelSkills } from '../src/core/skills.js';
import { validateKernel } from '../src/core/validate.js';

const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-skills-${name}-`));
  tempDirs.push(dir);
  await cp(join(process.cwd(), 'tests', 'fixtures', name), dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('lintKernelSkills', () => {
  test('passes valid canonical skills and discovers regression fixture plans', async () => {
    const rootDir = await copyFixture('skills-valid');

    const result = await lintKernelSkills(rootDir);

    expect(result.status).toBe('pass');
    expect(result.skillCount).toBe(1);
    expect(result.fixtureCount).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.fixtures).toEqual([
      {
        path: '.agent/evals/skills/kernel-core/basic.yaml',
        skillName: 'kernel-core',
        name: 'kernel core activation',
        prompt: 'Implement a non-trivial feature.',
        expectedActivates: true,
        expectedSkills: ['kernel-core']
      }
    ]);
  });

  test('reports deterministic skill metadata, trigger, output, and fixture warnings', async () => {
    const rootDir = await copyFixture('skills-invalid');

    const result = await lintKernelSkills(rootDir);

    expect(result.status).toBe('warn');
    expect(result.skillCount).toBe(2);
    expect(result.fixtureCount).toBe(0);
    expect(result.issues).toEqual([
      {
        code: 'invalid_skill_fixture',
        severity: 'warning',
        path: '.agent/evals/skills/broad/basic.yaml',
        message: 'Skill regression fixture must include `name`, `prompt`, and `expected.activates`.'
      },
      {
        code: 'missing_do_not_use_condition',
        severity: 'warning',
        path: '.agent/skills/broad/SKILL.md',
        message: 'Skill description must include a do-not-use boundary such as `Do not use`, `Do not trigger`, or `unless`.'
      },
      {
        code: 'missing_output_artifact',
        severity: 'warning',
        path: '.agent/skills/broad/SKILL.md',
        message: 'Skill output section should name a concrete `.agent/` artifact or state that no artifact is produced.'
      },
      {
        code: 'missing_skill_frontmatter',
        severity: 'warning',
        path: '.agent/skills/missing-meta/SKILL.md',
        message: 'Skill file must start with YAML frontmatter containing `name` and `description`.'
      },
      {
        code: 'missing_trigger_description',
        severity: 'warning',
        path: '.agent/skills/broad/SKILL.md',
        message: 'Skill description must describe an activation trigger with `Use when`, `Use before`, `Use after`, or `Use for`.'
      },
      {
        code: 'overbroad_skill_description',
        severity: 'warning',
        path: '.agent/skills/broad/SKILL.md',
        message: 'Skill description is overbroad; avoid words such as `anything`, `everything`, or `all tasks`.'
      },
      {
        code: 'skill_fixture_without_skill',
        severity: 'warning',
        path: '.agent/evals/skills/orphan/basic.yaml',
        message: 'Skill regression fixture references missing canonical skill `orphan`.'
      },
      {
        code: 'skill_name_mismatch',
        severity: 'warning',
        path: '.agent/skills/broad/SKILL.md',
        message: 'Skill frontmatter name `broad-helper` must match directory name `broad`.'
      }
    ]);
  });

  test('formats focused CLI output deterministically', async () => {
    const rootDir = await copyFixture('skills-invalid');

    const result = await lintKernelSkills(rootDir, { strict: true });

    expect(formatSkillLintResult(result)).toMatchInlineSnapshot(`
      "Skill lint status: fail
      Skills: 2
      Fixtures: 0
      Warnings: 8
      warning invalid_skill_fixture .agent/evals/skills/broad/basic.yaml - Skill regression fixture must include \`name\`, \`prompt\`, and \`expected.activates\`.
      warning missing_do_not_use_condition .agent/skills/broad/SKILL.md - Skill description must include a do-not-use boundary such as \`Do not use\`, \`Do not trigger\`, or \`unless\`.
      warning missing_output_artifact .agent/skills/broad/SKILL.md - Skill output section should name a concrete \`.agent/\` artifact or state that no artifact is produced.
      warning missing_skill_frontmatter .agent/skills/missing-meta/SKILL.md - Skill file must start with YAML frontmatter containing \`name\` and \`description\`.
      warning missing_trigger_description .agent/skills/broad/SKILL.md - Skill description must describe an activation trigger with \`Use when\`, \`Use before\`, \`Use after\`, or \`Use for\`.
      warning overbroad_skill_description .agent/skills/broad/SKILL.md - Skill description is overbroad; avoid words such as \`anything\`, \`everything\`, or \`all tasks\`.
      warning skill_fixture_without_skill .agent/evals/skills/orphan/basic.yaml - Skill regression fixture references missing canonical skill \`orphan\`.
      warning skill_name_mismatch .agent/skills/broad/SKILL.md - Skill frontmatter name \`broad-helper\` must match directory name \`broad\`."
    `);
  });

  test('formats deterministic skill lint JSON output for warnings and fixture plans', async () => {
    const invalidRootDir = await copyFixture('skills-invalid');
    const invalidResult = await lintKernelSkills(invalidRootDir, { strict: true });

    expect(formatSkillLintJsonResult(invalidResult)).toBe(
      `${JSON.stringify({ schemaVersion: 1, ...invalidResult }, null, 2)}\n`
    );
    expect(JSON.parse(formatSkillLintJsonResult(invalidResult))).toEqual({
      schemaVersion: 1,
      status: 'fail',
      strict: true,
      skillCount: 2,
      fixtureCount: 0,
      warningCount: 8,
      issues: [
        {
          code: 'invalid_skill_fixture',
          severity: 'warning',
          path: '.agent/evals/skills/broad/basic.yaml',
          message: 'Skill regression fixture must include `name`, `prompt`, and `expected.activates`.'
        },
        {
          code: 'missing_do_not_use_condition',
          severity: 'warning',
          path: '.agent/skills/broad/SKILL.md',
          message: 'Skill description must include a do-not-use boundary such as `Do not use`, `Do not trigger`, or `unless`.'
        },
        {
          code: 'missing_output_artifact',
          severity: 'warning',
          path: '.agent/skills/broad/SKILL.md',
          message: 'Skill output section should name a concrete `.agent/` artifact or state that no artifact is produced.'
        },
        {
          code: 'missing_skill_frontmatter',
          severity: 'warning',
          path: '.agent/skills/missing-meta/SKILL.md',
          message: 'Skill file must start with YAML frontmatter containing `name` and `description`.'
        },
        {
          code: 'missing_trigger_description',
          severity: 'warning',
          path: '.agent/skills/broad/SKILL.md',
          message: 'Skill description must describe an activation trigger with `Use when`, `Use before`, `Use after`, or `Use for`.'
        },
        {
          code: 'overbroad_skill_description',
          severity: 'warning',
          path: '.agent/skills/broad/SKILL.md',
          message: 'Skill description is overbroad; avoid words such as `anything`, `everything`, or `all tasks`.'
        },
        {
          code: 'skill_fixture_without_skill',
          severity: 'warning',
          path: '.agent/evals/skills/orphan/basic.yaml',
          message: 'Skill regression fixture references missing canonical skill `orphan`.'
        },
        {
          code: 'skill_name_mismatch',
          severity: 'warning',
          path: '.agent/skills/broad/SKILL.md',
          message: 'Skill frontmatter name `broad-helper` must match directory name `broad`.'
        }
      ],
      fixtures: []
    });

    const validRootDir = await copyFixture('skills-valid');
    const validResult = await lintKernelSkills(validRootDir);

    expect(JSON.parse(formatSkillLintJsonResult(validResult)).fixtures).toEqual([
      {
        path: '.agent/evals/skills/kernel-core/basic.yaml',
        skillName: 'kernel-core',
        name: 'kernel core activation',
        prompt: 'Implement a non-trivial feature.',
        expectedActivates: true,
        expectedSkills: ['kernel-core']
      }
    ]);
  });

  test('kernel validate includes skill lint warnings', async () => {
    const rootDir = await copyFixture('skills-invalid');

    const result = await validateKernel(rootDir);

    expect(result.status).toBe('warn');
    expect(result.errorCount).toBe(0);
    expect(result.issues.some((issue) => issue.code === 'skill_name_mismatch')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'invalid_skill_fixture')).toBe(true);
  });
});
