import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { getAdaptersForTarget } from '../src/adapters/index.js';
import { compileAdapters } from '../src/core/adapter-compiler.js';
import { formatValidationJsonResult, formatValidationResult, validateKernel } from '../src/core/validate.js';

const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-validate-${name}-`));
  tempDirs.push(dir);
  await cp(join(process.cwd(), 'tests', 'fixtures', name), dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('validateKernel', () => {
  test('passes a valid initialized Kernel fixture', async () => {
    const rootDir = await copyFixture('validate-valid');

    const result = await validateKernel(rootDir);

    expect(result.status).toBe('pass');
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.issues).toEqual([]);
  });

  test('reports invalid config as an error', async () => {
    const rootDir = await copyFixture('validate-invalid-config');

    const result = await validateKernel(rootDir);

    expect(result.status).toBe('fail');
    expect(result.issues).toEqual([
      {
        code: 'invalid_config',
        severity: 'error',
        path: '.agent/kernel.yaml',
        message: 'Invalid Kernel config in .agent/kernel.yaml.'
      }
    ]);
  });

  test('reports missing required .agent directories as deterministic errors', async () => {
    const rootDir = await copyFixture('validate-missing-dirs');

    const result = await validateKernel(rootDir);

    expect(result.status).toBe('fail');
    expect(result.issues.map((issue) => `${issue.code}:${issue.path}`)).toEqual([
      'missing_required_directory:.agent/adapters',
      'missing_required_directory:.agent/contracts',
      'missing_required_directory:.agent/evals',
      'missing_required_directory:.agent/evidence',
      'missing_required_directory:.agent/handoffs',
      'missing_required_directory:.agent/maps',
      'missing_required_directory:.agent/policies',
      'missing_required_directory:.agent/skills',
      'missing_required_directory:.agent/state'
    ]);
  });

  test('reports deterministic warnings for incomplete generated artifacts', async () => {
    const rootDir = await copyFixture('validate-warnings');

    const result = await validateKernel(rootDir);

    expect(result.status).toBe('warn');
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(6);
    expect(result.issues).toEqual([
      {
        code: 'missing_evidence_for_current_task',
        severity: 'warning',
        path: '.agent/evidence/warning-task.md',
        message: 'Current task `warning-task` does not have a matching evidence ledger.'
      },
      {
        code: 'missing_generated_header',
        severity: 'warning',
        path: '.agents/skills/kernel-core/SKILL.md',
        message: 'Generated adapter output is missing the Kernel generated header.'
      },
      {
        code: 'missing_generated_header',
        severity: 'warning',
        path: 'AGENTS.md',
        message: 'Generated adapter output is missing the Kernel generated header.'
      },
      {
        code: 'missing_map_file',
        severity: 'warning',
        path: '.agent/maps/commands.json',
        message: 'Map set is incomplete because `repo.json` is present but `commands.json` is missing.'
      },
      {
        code: 'missing_map_file',
        severity: 'warning',
        path: '.agent/maps/risk.json',
        message: 'Map set is incomplete because `repo.json` is present but `risk.json` is missing.'
      },
      {
        code: 'missing_map_file',
        severity: 'warning',
        path: '.agent/maps/tests.json',
        message: 'Map set is incomplete because `repo.json` is present but `tests.json` is missing.'
      }
    ]);
  });

  test('strict mode escalates warning-only validation to failure', async () => {
    const rootDir = await copyFixture('validate-warnings');

    const result = await validateKernel(rootDir, { strict: true });

    expect(result.status).toBe('fail');
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(6);
  });

  test('warns for missing outputs from every enabled priority adapter', async () => {
    const rootDir = await copyFixture('validate-adapters');

    const result = await validateKernel(rootDir);

    expect(result.status).toBe('warn');
    expect(result.errorCount).toBe(0);
    expect(result.issues.filter((issue) => issue.code === 'missing_adapter_output')).toHaveLength(18);
    expect(result.issues.filter((issue) => issue.code === 'missing_adapter_output').map((issue) => issue.path)).toEqual([
      '.agents/skills/kernel-core/SKILL.md',
      '.claude/skills/kernel-core/SKILL.md',
      '.claude/skills/kernel-debug/SKILL.md',
      '.claude/skills/kernel-handoff/SKILL.md',
      '.claude/skills/kernel-review/SKILL.md',
      '.cursor/rules/kernel-core.mdc',
      '.cursor/rules/kernel-quality.mdc',
      '.cursor/rules/kernel-security.mdc',
      '.github/copilot-instructions.md',
      '.github/instructions/review.instructions.md',
      '.github/instructions/testing.instructions.md',
      '.github/skills/kernel-core/SKILL.md',
      '.kiro/hooks/kernel-evidence.json',
      '.kiro/specs/kernel/requirements.md',
      '.kiro/steering/kernel.md',
      '.kiro/steering/verification.md',
      'AGENTS.md',
      'CLAUDE.md'
    ]);
  });

  test('passes after compile all generates every enabled adapter output', async () => {
    const rootDir = await copyFixture('validate-adapters');
    await compileAdapters(rootDir, getAdaptersForTarget('all'));

    const result = await validateKernel(rootDir);

    expect(result.status).toBe('pass');
    expect(result.issues).toEqual([]);
  });

  test('warns when a generated adapter output is stale', async () => {
    const rootDir = await copyFixture('validate-adapters');
    await compileAdapters(rootDir, getAdaptersForTarget('all'));
    const claudePath = join(rootDir, 'CLAUDE.md');
    const claude = await readFile(claudePath, 'utf8');
    await writeFile(claudePath, claude.replace('Project: Adapter Validation Fixture', 'Project: Stale Value'), 'utf8');

    const result = await validateKernel(rootDir);

    expect(result.issues).toContainEqual({
      code: 'stale_generated_file',
      severity: 'warning',
      path: 'CLAUDE.md',
      message: 'Generated adapter output differs from the current Kernel renderer output.'
    });
  });

  test('does not mark files stale when only manual sections differ', async () => {
    const rootDir = await copyFixture('validate-adapters');
    await compileAdapters(rootDir, getAdaptersForTarget('all'));
    const agentsPath = join(rootDir, 'AGENTS.md');
    const agents = await readFile(agentsPath, 'utf8');
    await writeFile(
      agentsPath,
      agents.replace('<!-- kernel:manual:start -->\n\n<!-- kernel:manual:end -->', [
        '<!-- kernel:manual:start -->',
        'Keep a repo-specific instruction.',
        '<!-- kernel:manual:end -->'
      ].join('\n')),
      'utf8'
    );

    const result = await validateKernel(rootDir);

    expect(result.status).toBe('pass');
    expect(result.issues).toEqual([]);
  });

  test('warns when an existing generated adapter output is missing its header', async () => {
    const rootDir = await copyFixture('validate-adapters');
    await compileAdapters(rootDir, getAdaptersForTarget('all'));
    const copilotPath = join(rootDir, '.github', 'copilot-instructions.md');
    const copilot = await readFile(copilotPath, 'utf8');
    await writeFile(copilotPath, copilot.replace(/^<!-- Generated by Kernel[^\n]*-->\n\n/, ''), 'utf8');

    const result = await validateKernel(rootDir);

    expect(result.issues).toContainEqual({
      code: 'missing_generated_header',
      severity: 'warning',
      path: '.github/copilot-instructions.md',
      message: 'Generated adapter output is missing the Kernel generated header.'
    });
    expect(result.issues.some((issue) => issue.code === 'stale_generated_file')).toBe(false);
  });
});

describe('formatValidationResult', () => {
  test('formats deterministic validation output for the CLI', async () => {
    const rootDir = await copyFixture('validate-warnings');

    const result = await validateKernel(rootDir, { strict: true });

    expect(formatValidationResult(result)).toMatchInlineSnapshot(`
      "Validation status: fail
      Errors: 0
      Warnings: 6
      warning missing_evidence_for_current_task .agent/evidence/warning-task.md - Current task \`warning-task\` does not have a matching evidence ledger.
      warning missing_generated_header .agents/skills/kernel-core/SKILL.md - Generated adapter output is missing the Kernel generated header.
      warning missing_generated_header AGENTS.md - Generated adapter output is missing the Kernel generated header.
      warning missing_map_file .agent/maps/commands.json - Map set is incomplete because \`repo.json\` is present but \`commands.json\` is missing.
      warning missing_map_file .agent/maps/risk.json - Map set is incomplete because \`repo.json\` is present but \`risk.json\` is missing.
      warning missing_map_file .agent/maps/tests.json - Map set is incomplete because \`repo.json\` is present but \`tests.json\` is missing."
    `);
  });

  test('formats deterministic validation JSON output for the CLI', async () => {
    const rootDir = await copyFixture('validate-warnings');

    const result = await validateKernel(rootDir, { strict: true });

    expect(formatValidationJsonResult(result)).toBe(`${JSON.stringify({ schemaVersion: 1, ...result }, null, 2)}\n`);
    expect(JSON.parse(formatValidationJsonResult(result))).toEqual({
      schemaVersion: 1,
      status: 'fail',
      strict: true,
      errorCount: 0,
      warningCount: 6,
      issues: [
        {
          code: 'missing_evidence_for_current_task',
          severity: 'warning',
          path: '.agent/evidence/warning-task.md',
          message: 'Current task `warning-task` does not have a matching evidence ledger.'
        },
        {
          code: 'missing_generated_header',
          severity: 'warning',
          path: '.agents/skills/kernel-core/SKILL.md',
          message: 'Generated adapter output is missing the Kernel generated header.'
        },
        {
          code: 'missing_generated_header',
          severity: 'warning',
          path: 'AGENTS.md',
          message: 'Generated adapter output is missing the Kernel generated header.'
        },
        {
          code: 'missing_map_file',
          severity: 'warning',
          path: '.agent/maps/commands.json',
          message: 'Map set is incomplete because `repo.json` is present but `commands.json` is missing.'
        },
        {
          code: 'missing_map_file',
          severity: 'warning',
          path: '.agent/maps/risk.json',
          message: 'Map set is incomplete because `repo.json` is present but `risk.json` is missing.'
        },
        {
          code: 'missing_map_file',
          severity: 'warning',
          path: '.agent/maps/tests.json',
          message: 'Map set is incomplete because `repo.json` is present but `tests.json` is missing.'
        }
      ]
    });
  });
});
