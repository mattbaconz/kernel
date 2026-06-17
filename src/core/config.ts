import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const SKILL_GENERATION_SETS = ['mvp', 'lint-ready'] as const;
export type SkillGenerationSet = (typeof SKILL_GENERATION_SETS)[number];

const defaultConfigValues = {
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
  }
} as const;

export const kernelConfigSchema = z
  .object({
    version: z.literal(1).default(defaultConfigValues.version),
    project: z
      .object({
        name: z.string().min(1).default(defaultConfigValues.project.name)
      })
      .default(defaultConfigValues.project),
    canonical: z
      .object({
        agent_dir: z.string().min(1).default(defaultConfigValues.canonical.agent_dir),
        skills_dir: z.string().min(1).default(defaultConfigValues.canonical.skills_dir),
        state_dir: z.string().min(1).default(defaultConfigValues.canonical.state_dir),
        evidence_dir: z.string().min(1).default(defaultConfigValues.canonical.evidence_dir),
        handoff_dir: z.string().min(1).default(defaultConfigValues.canonical.handoff_dir),
        maps_dir: z.string().min(1).default(defaultConfigValues.canonical.maps_dir)
      })
      .default(defaultConfigValues.canonical),
    generation: z
      .object({
        overwrite: z.boolean().default(defaultConfigValues.generation.overwrite),
        preserve_manual_sections: z.boolean().default(defaultConfigValues.generation.preserve_manual_sections),
        generated_header: z.boolean().default(defaultConfigValues.generation.generated_header)
      })
      .default(defaultConfigValues.generation),
    adapters: z
      .object({
        codex: z.boolean().default(defaultConfigValues.adapters.codex),
        claude: z.boolean().default(defaultConfigValues.adapters.claude),
        cursor: z.boolean().default(defaultConfigValues.adapters.cursor),
        kiro: z.boolean().default(defaultConfigValues.adapters.kiro),
        github_copilot: z.boolean().default(defaultConfigValues.adapters.github_copilot),
        gemini: z.boolean().default(defaultConfigValues.adapters.gemini),
        zed: z.boolean().default(defaultConfigValues.adapters.zed),
        opencode: z.boolean().default(defaultConfigValues.adapters.opencode),
        windsurf: z.boolean().default(defaultConfigValues.adapters.windsurf),
        junie: z.boolean().default(defaultConfigValues.adapters.junie)
      })
      .default(defaultConfigValues.adapters),
    skills: z
      .object({
        generated_set: z.enum(SKILL_GENERATION_SETS).default(defaultConfigValues.skills.generated_set)
      })
      .default(defaultConfigValues.skills),
    eval: z
      .object({
        default_runner: z.literal(defaultConfigValues.eval.default_runner).default(defaultConfigValues.eval.default_runner)
      })
      .default(defaultConfigValues.eval),
    commands: z.record(z.string(), z.string()).default(defaultConfigValues.commands),
    risk: z
      .object({
        high_risk_paths: z.array(z.string()).default([...defaultConfigValues.risk.high_risk_paths]),
        destructive_commands: z.array(z.string()).default([...defaultConfigValues.risk.destructive_commands])
      })
      .default({
        high_risk_paths: [...defaultConfigValues.risk.high_risk_paths],
        destructive_commands: [...defaultConfigValues.risk.destructive_commands]
      }),
    maps: z
      .object({
        include_codeowners: z.boolean().default(defaultConfigValues.maps.include_codeowners)
      })
      .default(defaultConfigValues.maps)
  })
  .strict();

export type KernelConfig = z.infer<typeof kernelConfigSchema>;

export const DEFAULT_KERNEL_CONFIG: KernelConfig = kernelConfigSchema.parse({});

export const KERNEL_CONFIG_FILE = join('.agent', 'kernel.yaml');

export class KernelConfigError extends Error {
  constructor(
    message: string,
    readonly configPath: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'KernelConfigError';
  }
}

export async function loadKernelConfig(rootDir: string = process.cwd()): Promise<KernelConfig> {
  const configPath = join(rootDir, KERNEL_CONFIG_FILE);
  const rawConfig = await readOptionalFile(configPath);

  if (rawConfig === null) {
    return kernelConfigSchema.parse({});
  }

  let parsedConfig: unknown;
  try {
    parsedConfig = parseYaml(rawConfig) ?? {};
  } catch (error) {
    throw new KernelConfigError('Failed to parse .agent/kernel.yaml as YAML.', configPath, { cause: error });
  }

  const result = kernelConfigSchema.safeParse(parsedConfig);
  if (!result.success) {
    throw new KernelConfigError('Invalid Kernel config in .agent/kernel.yaml.', configPath, {
      cause: result.error
    });
  }

  return result.data;
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
