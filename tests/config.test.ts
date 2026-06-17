import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { KernelConfigError, loadKernelConfig } from '../src/core/config.js';

const tempDirs: string[] = [];

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kernel-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('loadKernelConfig', () => {
  test('loads safe defaults when .agent/kernel.yaml is absent', async () => {
    const rootDir = await createTempRepo();

    const config = await loadKernelConfig(rootDir);

    expect(config).toEqual({
      version: 1,
      project: {
        name: 'Kernel Project'
      },
      canonical: {
        agent_dir: '.agent',
        skills_dir: '.agent/skills',
        state_dir: '.agent/state',
        evidence_dir: '.agent/evidence',
        handoff_dir: '.agent/handoffs',
        maps_dir: '.agent/maps'
      },
      generation: {
        overwrite: false,
        preserve_manual_sections: true,
        generated_header: true
      },
      adapters: {
        codex: true,
        claude: true,
        cursor: true,
        kiro: true,
        github_copilot: true,
        gemini: false,
        zed: false,
        opencode: false,
        windsurf: false,
        junie: false
      },
      skills: {
        generated_set: 'mvp'
      },
      eval: {
        default_runner: 'static'
      },
      commands: {},
      risk: {
        high_risk_paths: [],
        destructive_commands: []
      },
      maps: {
        include_codeowners: true
      },
      context: {
        github: {}
      }
    });
  });

  test('loads and validates a config file', async () => {
    const rootDir = await createTempRepo();
    await mkdir(join(rootDir, '.agent'), { recursive: true });
    await writeFile(
      join(rootDir, '.agent', 'kernel.yaml'),
      [
        'version: 1',
        'project:',
        '  name: Test Kernel',
        'canonical:',
        '  agent_dir: .kernel',
        '  skills_dir: .kernel/skills',
        '  state_dir: .kernel/state',
        '  evidence_dir: .kernel/evidence',
        '  handoff_dir: .kernel/handoffs',
        '  maps_dir: .kernel/maps',
        'generation:',
        '  overwrite: false',
        '  preserve_manual_sections: false',
        '  generated_header: false',
        'adapters:',
        '  codex: true',
        '  claude: false',
        '  cursor: true',
        '  kiro: false',
        '  github_copilot: true',
        'skills:',
        '  generated_set: lint-ready',
        'eval:',
        '  default_runner: static',
        ''
      ].join('\n'),
      'utf8'
    );

    const config = await loadKernelConfig(rootDir);

    expect(config.project.name).toBe('Test Kernel');
    expect(config.canonical.agent_dir).toBe('.kernel');
    expect(config.generation.preserve_manual_sections).toBe(false);
    expect(config.adapters.claude).toBe(false);
    expect(config.skills.generated_set).toBe('lint-ready');
    expect(config.eval.default_runner).toBe('static');
  });

  test('rejects unknown skill generation set config', async () => {
    const rootDir = await createTempRepo();
    await mkdir(join(rootDir, '.agent'), { recursive: true });
    await writeFile(
      join(rootDir, '.agent', 'kernel.yaml'),
      ['version: 1', 'skills:', '  generated_set: everything', ''].join('\n'),
      'utf8'
    );

    await expect(loadKernelConfig(rootDir)).rejects.toBeInstanceOf(KernelConfigError);
  });

  test('rejects unsafe eval runner config', async () => {
    const rootDir = await createTempRepo();
    await mkdir(join(rootDir, '.agent'), { recursive: true });
    await writeFile(
      join(rootDir, '.agent', 'kernel.yaml'),
      ['version: 1', 'eval:', '  default_runner: live', ''].join('\n'),
      'utf8'
    );

    await expect(loadKernelConfig(rootDir)).rejects.toBeInstanceOf(KernelConfigError);
  });

  test('rejects unknown eval runner config', async () => {
    const rootDir = await createTempRepo();
    await mkdir(join(rootDir, '.agent'), { recursive: true });
    await writeFile(
      join(rootDir, '.agent', 'kernel.yaml'),
      ['version: 1', 'eval:', '  default_runner: unknown', ''].join('\n'),
      'utf8'
    );

    await expect(loadKernelConfig(rootDir)).rejects.toBeInstanceOf(KernelConfigError);
  });

  test('loads optional context.github config', async () => {
    const rootDir = await createTempRepo();
    await mkdir(join(rootDir, '.agent'), { recursive: true });
    await writeFile(
      join(rootDir, '.agent', 'kernel.yaml'),
      ['version: 1', 'context:', '  github:', '    owner: mattbaconz', '    repo: kernel', ''].join('\n'),
      'utf8'
    );

    const config = await loadKernelConfig(rootDir);

    expect(config.context.github.owner).toBe('mattbaconz');
    expect(config.context.github.repo).toBe('kernel');
  });

  test('rejects invalid config', async () => {
    const rootDir = await createTempRepo();
    await mkdir(join(rootDir, '.agent'), { recursive: true });
    await writeFile(
      join(rootDir, '.agent', 'kernel.yaml'),
      ['version: bad', 'project:', '  name: 123', ''].join('\n'),
      'utf8'
    );

    await expect(loadKernelConfig(rootDir)).rejects.toBeInstanceOf(KernelConfigError);
  });

  test('loads optional commands and risk blocks', async () => {
    const rootDir = await createTempRepo();
    await mkdir(join(rootDir, '.agent'), { recursive: true });
    await writeFile(
      join(rootDir, '.agent', 'kernel.yaml'),
      [
        'version: 1',
        'commands:',
        '  test: pnpm test',
        'risk:',
        '  high_risk_paths:',
        '    - src/core/**',
        '  destructive_commands:',
        '    - npm publish',
        'maps:',
        '  include_codeowners: false',
        ''
      ].join('\n'),
      'utf8'
    );

    const config = await loadKernelConfig(rootDir);

    expect(config.commands).toEqual({ test: 'pnpm test' });
    expect(config.risk.high_risk_paths).toEqual(['src/core/**']);
    expect(config.risk.destructive_commands).toEqual(['npm publish']);
    expect(config.maps.include_codeowners).toBe(false);
  });
});
