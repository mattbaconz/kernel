import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createKernelProgram, formatSkillGenerateJsonResult, formatSkillGenerateResult } from '../src/cli/index.js';
import type { Command } from 'commander';

const repoRoot = process.cwd();
const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-cli-${name}-`));
  tempDirs.push(dir);
  await cp(join(repoRoot, 'tests', 'fixtures', name), dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function helpFor(args: string[]): string {
  const program = createKernelProgram();
  let output = '';
  captureOutput(program, (text) => {
    output += text;
  });
  program.exitOverride();
  try {
    program.parse(args, { from: 'user' });
  } catch (error) {
    if (!(error instanceof Error) || !isHelpExit(error)) {
      throw error;
    }
  }
  return output;
}

function captureOutput(command: Command, write: (text: string) => void): void {
  command.configureOutput({
    writeOut: write,
    writeErr: write
  });
  for (const subcommand of command.commands) {
    captureOutput(subcommand, write);
    subcommand.exitOverride();
  }
}

function isHelpExit(error: Error): boolean {
  if ('code' in error && error.code === 'commander.helpDisplayed') {
    return true;
  }

  return error.message.startsWith('process.exit unexpectedly called with "0"');
}

async function runCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: string | number }> {
  let stdout = '';
  let stderr = '';
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  });
  const stderrSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
    stderr += `${values.map(String).join(' ')}\n`;
  });

  process.exitCode = undefined;
  process.chdir(cwd);
  try {
    const program = createKernelProgram();
    await program.parseAsync(args, { from: 'user' });
    return {
      stdout,
      stderr,
      exitCode: process.exitCode ?? 0
    };
  } finally {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

describe('Kernel CLI help', () => {
  test('supports kernel --help', () => {
    const output = helpFor(['--help']);

    expect(output).toContain('Usage: kernel');
    expect(output).toContain('init');
    expect(output).toContain('map');
    expect(output).toContain('validate');
    expect(output).toContain('compile');
    expect(output).toContain('task');
    expect(output).toContain('evidence');
    expect(output).toContain('handoff');
    expect(output).toContain('skill');
    expect(output).toContain('eval');
    expect(output).toContain('schema');
  });

  test('supports kernel init --help', () => {
    const output = helpFor(['init', '--help']);

    expect(output).toContain('Usage: kernel init');
    expect(output).toContain('--force');
    expect(output).toContain('--dry-run');
  });

  test('supports kernel map --help', () => {
    const output = helpFor(['map', '--help']);

    expect(output).toContain('Usage: kernel map');
    expect(output).toContain('--dry-run');
    expect(output).toContain('--force');
    expect(output).toContain('--include-docs-vault');
  });

  test('supports kernel validate --help', () => {
    const output = helpFor(['validate', '--help']);

    expect(output).toContain('Usage: kernel validate');
    expect(output).toContain('--strict');
    expect(output).toContain('--json');
  });

  test('supports kernel compile --help', () => {
    const output = helpFor(['compile', '--help']);

    expect(output).toContain('Usage: kernel compile');
    expect(output).toContain('target');
  });

  test('supports artifact command help', () => {
    expect(helpFor(['task', 'new', '--help'])).toContain('Usage: kernel task new');
    expect(helpFor(['evidence', 'new', '--help'])).toContain('Usage: kernel evidence new');
    expect(helpFor(['handoff', 'new', '--help'])).toContain('Usage: kernel handoff new');
  });

  test('supports skill lint help', () => {
    const output = helpFor(['skill', 'lint', '--help']);

    expect(output).toContain('Usage: kernel skill lint');
    expect(output).toContain('--strict');
    expect(output).toContain('--json');
  });

  test('supports skill generate help', () => {
    const output = helpFor(['skill', 'generate', '--help']);

    expect(output).toContain('Usage: kernel skill generate');
    expect(output).toContain('--docs-vault');
    expect(output).toContain('--set');
    expect(output).toContain('--json');
    expect(output).toContain('--dry-run');
    expect(output).toContain('--force');
  });

  test('formats skipped skill generation docs deterministically', () => {
    const output = formatSkillGenerateResult({
      skills: ['debug-probe'],
      generationSet: 'lint-ready',
      dryRun: false,
      files: [
        {
          action: 'created',
          relativePath: '.agent/skills/debug-probe/SKILL.md',
          path: 'C:/repo/.agent/skills/debug-probe/SKILL.md'
        }
      ],
      skipped: [
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
      ]
    });

    expect(output).toBe(
      [
        'created: .agent/skills/debug-probe/SKILL.md',
        'skipped: 03-skills/unready-skill.md - missing_output_artifact: Skill doc output must mention a `.agent/` artifact or state that no artifact is produced.'
      ].join('\n')
    );
  });

  test('formats skill generation JSON output deterministically', () => {
    const result = {
      generationSet: 'lint-ready' as const,
      dryRun: true,
      skills: ['debug-probe'],
      files: [
        {
          action: 'would-create' as const,
          relativePath: '.agent/skills/debug-probe/SKILL.md',
          path: 'C:/repo/.agent/skills/debug-probe/SKILL.md'
        }
      ],
      skipped: [
        {
          skillName: 'unready-skill',
          relativePath: '03-skills/unready-skill.md',
          reasons: [
            {
              code: 'missing_output_artifact' as const,
              message: 'Skill doc output must mention a `.agent/` artifact or state that no artifact is produced.'
            }
          ]
        }
      ]
    };

    expect(formatSkillGenerateJsonResult(result)).toBe(`${JSON.stringify({ schemaVersion: 1, ...result }, null, 2)}\n`);
  });

  test('supports kernel eval help', () => {
    const output = helpFor(['eval', '--help']);

    expect(output).toContain('Usage: kernel eval');
    expect(output).toContain('--skill');
    expect(output).toContain('--runner');
    expect(output).not.toContain('[default: "static"]');
    expect(output).toContain('--summary');
    expect(output).toContain('--json');
    expect(output).toContain('--dry-run');
    expect(output).toContain('--force');
  });

  test('supports schema command help', () => {
    expect(helpFor(['schema', '--help'])).toContain('Usage: kernel schema');
    expect(helpFor(['schema', 'versions', '--help'])).toContain('Usage: kernel schema versions');
    expect(helpFor(['schema', 'versions', '--help'])).toContain('--json');
    expect(helpFor(['schema', 'list', '--help'])).toContain('Usage: kernel schema list');
    expect(helpFor(['schema', 'list', '--help'])).toContain('--json');
    expect(helpFor(['schema', 'list', '--help'])).toContain('--schema-version');
    expect(helpFor(['schema', 'path', '--help'])).toContain('Usage: kernel schema path');
    expect(helpFor(['schema', 'path', '--help'])).toContain('--json');
    expect(helpFor(['schema', 'path', '--help'])).toContain('--schema-version');
    expect(helpFor(['schema', 'show', '--help'])).toContain('Usage: kernel schema show');
    expect(helpFor(['schema', 'show', '--help'])).toContain('--json');
    expect(helpFor(['schema', 'show', '--help'])).toContain('--schema-version');
  });
});

describe('Kernel CLI schema discovery', () => {
  test('lists supported schema versions', async () => {
    const text = await runCli(['schema', 'versions'], repoRoot);
    const json = await runCli(['schema', 'versions', '--json'], repoRoot);

    expect(text.exitCode).toBe(0);
    expect(text.stdout).toBe('v1\n');
    expect(text.stderr).toBe('');
    expect(JSON.parse(json.stdout)).toEqual({
      schemaVersion: 1,
      versions: ['v1']
    });
  });

  test('lists version 1 schema names deterministically', async () => {
    const result = await runCli(['schema', 'list'], repoRoot);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      [
        'error-envelope',
        'schema-list-result',
        'schema-path-result',
        'schema-show-result',
        'schema-versions-result',
        'skill-eval-result',
        'skill-generate-result',
        'skill-lint-result',
        'validation-result',
        ''
      ].join('\n')
    );
  });

  test('lists version 1 schema descriptors as JSON', async () => {
    const result = await runCli(['schema', 'list', '--schema-version', 'v1', '--json'], repoRoot);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      schemas: Array<{
        version: string;
        name: string;
        fileName: string;
        path: string;
      }>;
    };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(parsed).toEqual({
      schemaVersion: 1,
      schemas: [
        {
          version: 'v1',
          name: 'error-envelope',
          fileName: 'error-envelope.schema.json',
          path: join(repoRoot, 'schemas', 'json', 'v1', 'error-envelope.schema.json')
        },
        {
          version: 'v1',
          name: 'schema-list-result',
          fileName: 'schema-list-result.schema.json',
          path: join(repoRoot, 'schemas', 'json', 'v1', 'schema-list-result.schema.json')
        },
        {
          version: 'v1',
          name: 'schema-path-result',
          fileName: 'schema-path-result.schema.json',
          path: join(repoRoot, 'schemas', 'json', 'v1', 'schema-path-result.schema.json')
        },
        {
          version: 'v1',
          name: 'schema-show-result',
          fileName: 'schema-show-result.schema.json',
          path: join(repoRoot, 'schemas', 'json', 'v1', 'schema-show-result.schema.json')
        },
        {
          version: 'v1',
          name: 'schema-versions-result',
          fileName: 'schema-versions-result.schema.json',
          path: join(repoRoot, 'schemas', 'json', 'v1', 'schema-versions-result.schema.json')
        },
        {
          version: 'v1',
          name: 'skill-eval-result',
          fileName: 'skill-eval-result.schema.json',
          path: join(repoRoot, 'schemas', 'json', 'v1', 'skill-eval-result.schema.json')
        },
        {
          version: 'v1',
          name: 'skill-generate-result',
          fileName: 'skill-generate-result.schema.json',
          path: join(repoRoot, 'schemas', 'json', 'v1', 'skill-generate-result.schema.json')
        },
        {
          version: 'v1',
          name: 'skill-lint-result',
          fileName: 'skill-lint-result.schema.json',
          path: join(repoRoot, 'schemas', 'json', 'v1', 'skill-lint-result.schema.json')
        },
        {
          version: 'v1',
          name: 'validation-result',
          fileName: 'validation-result.schema.json',
          path: join(repoRoot, 'schemas', 'json', 'v1', 'validation-result.schema.json')
        }
      ]
    });
  });

  test('prints the version 1 schema directory path', async () => {
    const result = await runCli(['schema', 'path'], repoRoot);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${join(repoRoot, 'schemas', 'json', 'v1')}\n`);
  });

  test('prints the version 1 schema directory path as JSON', async () => {
    const result = await runCli(['schema', 'path', '--json'], repoRoot);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      version: string;
      path: string;
    };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(parsed).toEqual({
      schemaVersion: 1,
      version: 'v1',
      path: join(repoRoot, 'schemas', 'json', 'v1')
    });
  });

  test('prints a named version 1 schema file path', async () => {
    const result = await runCli(['schema', 'path', 'skill-eval-result'], repoRoot);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${join(repoRoot, 'schemas', 'json', 'v1', 'skill-eval-result.schema.json')}\n`);
  });

  test('prints a named version 1 schema file path as JSON', async () => {
    const result = await runCli(['schema', 'path', 'skill-eval-result', '--schema-version', 'v1', '--json'], repoRoot);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      version: string;
      path: string;
      schema: {
        version: string;
        name: string;
        fileName: string;
        path: string;
      };
    };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(parsed).toEqual({
      schemaVersion: 1,
      version: 'v1',
      path: join(repoRoot, 'schemas', 'json', 'v1', 'skill-eval-result.schema.json'),
      schema: {
        version: 'v1',
        name: 'skill-eval-result',
        fileName: 'skill-eval-result.schema.json',
        path: join(repoRoot, 'schemas', 'json', 'v1', 'skill-eval-result.schema.json')
      }
    });
  });

  test('accepts schema filenames when resolving paths', async () => {
    const result = await runCli(['schema', 'path', 'skill-eval-result.schema.json'], repoRoot);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${join(repoRoot, 'schemas', 'json', 'v1', 'skill-eval-result.schema.json')}\n`);
  });

  test('rejects unknown schema names', async () => {
    const result = await runCli(['schema', 'path', 'missing-schema'], repoRoot);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'Unknown Kernel schema `missing-schema`. Run `kernel schema list` to see available schemas.\n'
    );
  });

  test('prints a JSON error envelope for unknown schema names in JSON mode', async () => {
    const result = await runCli(['schema', 'path', 'missing-schema', '--json'], repoRoot);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      status: string;
      error: {
        code: string;
        command: string;
        message: string;
        schemaName: string;
      };
    };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(parsed).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: {
        code: 'unknown_schema',
        command: 'schema path',
        message: 'Unknown Kernel schema `missing-schema`. Run `kernel schema list` to see available schemas.',
        schemaName: 'missing-schema'
      }
    });
  });

  test('shows raw schema file contents', async () => {
    const result = await runCli(['schema', 'show', 'skill-eval-result'], repoRoot);
    const expected = await readFile(join(repoRoot, 'schemas', 'json', 'v1', 'skill-eval-result.schema.json'), 'utf8');

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual(JSON.parse(expected));
  });

  test('shows schema file contents with metadata as JSON', async () => {
    const result = await runCli(['schema', 'show', 'skill-eval-result', '--schema-version', 'v1', '--json'], repoRoot);
    const expected = JSON.parse(await readFile(join(repoRoot, 'schemas', 'json', 'v1', 'skill-eval-result.schema.json'), 'utf8')) as unknown;

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 1,
      version: 'v1',
      schema: {
        version: 'v1',
        name: 'skill-eval-result',
        fileName: 'skill-eval-result.schema.json',
        path: join(repoRoot, 'schemas', 'json', 'v1', 'skill-eval-result.schema.json')
      },
      content: expected
    });
  });

  test('rejects unknown schema versions in text and JSON modes', async () => {
    const text = await runCli(['schema', 'list', '--schema-version', 'v2'], repoRoot);
    const json = await runCli(['schema', 'path', 'skill-eval-result', '--schema-version', 'v2', '--json'], repoRoot);

    expect(text.exitCode).toBe(1);
    expect(text.stdout).toBe('');
    expect(text.stderr).toBe('Unknown Kernel schema version `v2`. Supported versions: v1.\n');
    expect(JSON.parse(json.stdout)).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: {
        code: 'unknown_schema_version',
        command: 'schema path',
        message: 'Unknown Kernel schema version `v2`. Supported versions: v1.',
        schemaVersionId: 'v2'
      }
    });
  });
});

describe('Kernel package metadata', () => {
  test('includes schemas in packaged distributions', async () => {
    const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
      files?: string[];
    };

    expect(packageJson.files).toEqual(expect.arrayContaining(['dist', 'schemas']));
  });
});

describe('Kernel CLI JSON error envelopes', () => {
  test('prints a JSON envelope for eval unknown-runner failures in JSON mode', async () => {
    const rootDir = await copyFixture('eval-skills');

    const result = await runCli(['eval', '--runner', 'unknown', '--json'], rootDir);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      status: string;
      error: {
        code: string;
        command: string;
        message: string;
        runnerId: string;
      };
    };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(parsed).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: {
        code: 'unknown_runner',
        command: 'eval',
        message: 'Unknown eval runner `unknown`. Available safe runners: static.',
        runnerId: 'unknown'
      }
    });
  });

  test('prints a JSON envelope for eval config failures in JSON mode', async () => {
    const rootDir = await copyFixture('eval-skills-config-unknown');

    const result = await runCli(['eval', '--json'], rootDir);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      status: string;
      error: {
        code: string;
        command: string;
        message: string;
        path: string;
      };
    };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(parsed).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: {
        code: 'invalid_config',
        command: 'eval',
        message: 'Invalid Kernel config in .agent/kernel.yaml.',
        path: join(rootDir, '.agent', 'kernel.yaml').replace(/\\/g, '/')
      }
    });
  });

  test('preserves text stderr for eval runner failures outside JSON mode', async () => {
    const rootDir = await copyFixture('eval-skills');

    const result = await runCli(['eval', '--runner', 'unknown'], rootDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Unknown eval runner `unknown`. Available safe runners: static.\n');
  });

  test('prints a JSON envelope for skill-generate config failures in JSON mode', async () => {
    const rootDir = await copyFixture('eval-skills-config-unknown');

    const result = await runCli(['skill', 'generate', '--docs-vault', 'public_docs_fixture', '--json'], rootDir);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      status: string;
      error: {
        code: string;
        command: string;
        message: string;
        path: string;
      };
    };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(parsed).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: {
        code: 'invalid_config',
        command: 'skill generate',
        message: 'Invalid Kernel config in .agent/kernel.yaml.',
        path: join(rootDir, '.agent', 'kernel.yaml').replace(/\\/g, '/')
      }
    });
  });

  test('prints a JSON envelope for skill-generate overwrite refusals in JSON mode', async () => {
    const rootDir = await copyFixture('skill-generate-basic');
    const targetPath = join(rootDir, '.agent', 'skills', 'adapter-compiler', 'SKILL.md');
    await mkdir(join(rootDir, '.agent', 'skills', 'adapter-compiler'), { recursive: true });
    await writeFile(targetPath, 'user-authored skill\n', 'utf8');

    const result = await runCli(['skill', 'generate', '--docs-vault', 'public_docs_fixture', '--json'], rootDir);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      status: string;
      error: {
        code: string;
        command: string;
        message: string;
        path: string;
      };
    };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(parsed).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: {
        code: 'file_exists',
        command: 'skill generate',
        message: 'Refusing to overwrite existing file without force.',
        path: targetPath.replace(/\\/g, '/')
      }
    });
  });

  test('prints a JSON envelope for skill-lint config failures in JSON mode', async () => {
    const rootDir = await copyFixture('eval-skills-config-unknown');

    const result = await runCli(['skill', 'lint', '--json'], rootDir);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      status: string;
      error: {
        code: string;
        command: string;
        message: string;
        path: string;
      };
    };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(parsed).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: {
        code: 'invalid_config',
        command: 'skill lint',
        message: 'Invalid Kernel config in .agent/kernel.yaml.',
        path: join(rootDir, '.agent', 'kernel.yaml').replace(/\\/g, '/')
      }
    });
  });

  test('prints a JSON envelope for validate config failures in JSON mode', async () => {
    const rootDir = await copyFixture('validate-invalid-config');

    const result = await runCli(['validate', '--json'], rootDir);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      status: string;
      error: {
        code: string;
        command: string;
        message: string;
        path: string;
      };
    };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(parsed).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: {
        code: 'invalid_config',
        command: 'validate',
        message: 'Invalid Kernel config in .agent/kernel.yaml.',
        path: join(rootDir, '.agent', 'kernel.yaml').replace(/\\/g, '/')
      }
    });
  });
});
