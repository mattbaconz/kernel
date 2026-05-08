import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { KernelFileExistsError } from '../src/core/fs.js';
import { MANUAL_END, MANUAL_START } from '../src/core/manual-sections.js';
import { generateCanonicalSkills, MVP_SKILL_NAMES } from '../src/core/skill-generator.js';
import { lintKernelSkills } from '../src/core/skills.js';

const PUBLIC_DOCS_FIXTURE_DIR = 'public_docs_fixture';
const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-skill-generate-${name}-`));
  tempDirs.push(dir);
  await cp(join(process.cwd(), 'tests', 'fixtures', name), dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('generateCanonicalSkills', () => {
  test('generates the MVP canonical skill set from the documentation vault', async () => {
    const rootDir = await copyFixture('skill-generate-basic');

    const result = await generateCanonicalSkills(rootDir, { docsVaultDir: PUBLIC_DOCS_FIXTURE_DIR });

    expect(result.generationSet).toBe('mvp');
    expect(result.dryRun).toBe(false);
    expect(result.skills).toEqual(MVP_SKILL_NAMES);
    expect(result.skipped).toEqual([]);
    expect(result.files.map((entry) => entry.relativePath)).toEqual([
      '.agent/skills/adapter-compiler/SKILL.md',
      '.agent/skills/evidence-ledger/SKILL.md',
      '.agent/skills/handoff-packet/SKILL.md',
      '.agent/skills/kernel-core/SKILL.md',
      '.agent/skills/task-contract/SKILL.md',
      '.agent/skills/verify-lattice/SKILL.md'
    ]);
    expect(result.files.every((entry) => entry.action === 'created')).toBe(true);

    const kernelCore = await readFile(join(rootDir, '.agent', 'skills', 'kernel-core', 'SKILL.md'), 'utf8');
    expect(kernelCore).toContain('name: kernel-core');
    expect(kernelCore).toContain('Use before and after any non-trivial coding-agent task.');
    expect(kernelCore).toContain('Write a concise artifact under `.agent/`');
    expect(kernelCore).toContain(MANUAL_START);
    expect(kernelCore).toContain(MANUAL_END);

    const adapterCompiler = await readFile(
      join(rootDir, '.agent', 'skills', 'adapter-compiler', 'SKILL.md'),
      'utf8'
    );
    expect(adapterCompiler).toContain(
      'description: "Use when generating ADE-specific files from canonical Kernel source. Do not trigger it for unrelated work just because the skill exists."'
    );

    const lintResult = await lintKernelSkills(rootDir, { strict: true });
    expect(lintResult.status).toBe('pass');
    expect(lintResult.skillCount).toBe(MVP_SKILL_NAMES.length);
    expect(lintResult.warningCount).toBe(0);
    expect(lintResult.issues).toEqual([]);
  });

  test('expands to lint-ready documentation vault skills when configured', async () => {
    const rootDir = await copyFixture('skill-generate-basic');
    await mkdir(join(rootDir, '.agent'), { recursive: true });
    await writeFile(
      join(rootDir, '.agent', 'kernel.yaml'),
      ['version: 1', 'skills:', '  generated_set: lint-ready', ''].join('\n'),
      'utf8'
    );

    const result = await generateCanonicalSkills(rootDir, { docsVaultDir: PUBLIC_DOCS_FIXTURE_DIR });

    expect(result.generationSet).toBe('lint-ready');
    expect(result.dryRun).toBe(false);
    expect(result.skills).toEqual([
      'adapter-compiler',
      'debug-probe',
      'evidence-ledger',
      'handoff-packet',
      'kernel-core',
      'task-contract',
      'verify-lattice'
    ]);
    expect(result.files.map((entry) => entry.relativePath)).toEqual([
      '.agent/skills/adapter-compiler/SKILL.md',
      '.agent/skills/debug-probe/SKILL.md',
      '.agent/skills/evidence-ledger/SKILL.md',
      '.agent/skills/handoff-packet/SKILL.md',
      '.agent/skills/kernel-core/SKILL.md',
      '.agent/skills/task-contract/SKILL.md',
      '.agent/skills/verify-lattice/SKILL.md'
    ]);
    expect(result.skipped).toEqual([
      {
        skillName: 'bad-heading',
        relativePath: '03-skills/bad-heading.md',
        reasons: [
          {
            code: 'skill_heading_mismatch',
            message: 'Skill doc H1 heading must match the filename-derived skill name.'
          },
          {
            code: 'missing_skill_workflow',
            message: 'Skill doc must include a `## Workflow` or `## Procedure` section.'
          }
        ]
      },
      {
        skillName: 'unready-skill',
        relativePath: '03-skills/unready-skill.md',
        reasons: [
          {
            code: 'missing_output_artifact',
            message: 'Skill doc output must mention a `.agent/` artifact or state that no artifact is produced.'
          }
        ]
      }
    ]);
    await expect(readFile(join(rootDir, '.agent', 'skills', 'unready-skill', 'SKILL.md'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(rootDir, '.agent', 'skills', 'bad-heading', 'SKILL.md'), 'utf8')).rejects.toThrow();

    const lintResult = await lintKernelSkills(rootDir, { strict: true });
    expect(lintResult.status).toBe('pass');
    expect(lintResult.skillCount).toBe(7);
    expect(lintResult.warningCount).toBe(0);
  });

  test('allows CLI callers to override the configured generated skill set', async () => {
    const rootDir = await copyFixture('skill-generate-basic');
    await mkdir(join(rootDir, '.agent'), { recursive: true });
    await writeFile(
      join(rootDir, '.agent', 'kernel.yaml'),
      ['version: 1', 'skills:', '  generated_set: mvp', ''].join('\n'),
      'utf8'
    );

    const result = await generateCanonicalSkills(rootDir, {
      docsVaultDir: PUBLIC_DOCS_FIXTURE_DIR,
      set: 'lint-ready'
    });

    expect(result.generationSet).toBe('lint-ready');
    expect(result.skills).toEqual([
      'adapter-compiler',
      'debug-probe',
      'evidence-ledger',
      'handoff-packet',
      'kernel-core',
      'task-contract',
      'verify-lattice'
    ]);
    expect(result.skipped.map((entry) => entry.skillName)).toEqual(['bad-heading', 'unready-skill']);
  });

  test('supports dry-run without writing skill files', async () => {
    const rootDir = await copyFixture('skill-generate-basic');

    const result = await generateCanonicalSkills(rootDir, { docsVaultDir: PUBLIC_DOCS_FIXTURE_DIR, dryRun: true });

    expect(result.generationSet).toBe('mvp');
    expect(result.dryRun).toBe(true);
    expect(result.files.every((entry) => entry.action === 'would-create')).toBe(true);
    await expect(readFile(join(rootDir, '.agent', 'skills', 'kernel-core', 'SKILL.md'), 'utf8')).rejects.toThrow();
  });

  test('refuses to overwrite existing canonical skills by default', async () => {
    const rootDir = await copyFixture('skill-generate-basic');
    const target = join(rootDir, '.agent', 'skills', 'kernel-core', 'SKILL.md');
    await mkdir(join(rootDir, '.agent', 'skills', 'kernel-core'), { recursive: true });
    await writeFile(target, 'user-authored skill\n', 'utf8');

    await expect(generateCanonicalSkills(rootDir, { docsVaultDir: PUBLIC_DOCS_FIXTURE_DIR })).rejects.toBeInstanceOf(
      KernelFileExistsError
    );
    await expect(readFile(target, 'utf8')).resolves.toBe('user-authored skill\n');
    await expect(readFile(join(rootDir, '.agent', 'skills', 'adapter-compiler', 'SKILL.md'), 'utf8')).rejects.toThrow();
  });

  test('allows force updates and preserves manual sections', async () => {
    const rootDir = await copyFixture('skill-generate-basic');
    const target = join(rootDir, '.agent', 'skills', 'kernel-core', 'SKILL.md');
    await mkdir(join(rootDir, '.agent', 'skills', 'kernel-core'), { recursive: true });
    await writeFile(
      target,
      [
        '---',
        'name: kernel-core',
        'description: old',
        '---',
        '',
        '# kernel-core',
        '',
        '## Manual notes',
        '',
        MANUAL_START,
        'Keep this local skill note.',
        MANUAL_END,
        ''
      ].join('\n'),
      'utf8'
    );

    const result = await generateCanonicalSkills(rootDir, { docsVaultDir: PUBLIC_DOCS_FIXTURE_DIR, force: true });

    expect(result.files.find((entry) => entry.relativePath === '.agent/skills/kernel-core/SKILL.md')?.action).toBe(
      'updated'
    );
    const kernelCore = await readFile(target, 'utf8');
    expect(kernelCore).toContain('Use before and after any non-trivial coding-agent task.');
    expect(kernelCore).toContain('Keep this local skill note.');
  });
});
