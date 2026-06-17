import { stringify as stringifyYaml } from 'yaml';

import type { KernelConfig } from '../config.js';
import type { PolicyGate } from './schema.js';

export const DEFAULT_POLICY_GATE: PolicyGate = {
  version: 1,
  commands: [
    { class: 'block', match: 'npm publish', reason: 'package publishing' },
    { class: 'block', match: 'pnpm publish', reason: 'package publishing' },
    { class: 'block', match: 'git push --force', reason: 'force push' },
    { class: 'block', match: 'git reset --hard', reason: 'destructive git reset' },
    { class: 'block', match: 'rm -rf', reason: 'recursive deletion' },
    { class: 'review', match: 'pnpm install', reason: 'dependency install' },
    { class: 'review', match: 'npm install', reason: 'dependency install' }
  ],
  paths: [
    {
      pattern: '.github/workflows/**',
      class: 'review',
      reason: 'CI workflow',
      min_verification: 'L3',
      required_skills: ['verify-lattice']
    },
    {
      pattern: 'src/core/**',
      class: 'review',
      reason: 'core runtime',
      min_verification: 'L3',
      required_skills: ['verify-lattice']
    },
    {
      pattern: 'src/adapters/**',
      class: 'review',
      reason: 'adapter compiler output',
      min_verification: 'L3',
      required_skills: ['verify-lattice']
    }
  ],
  escalation: {
    by_task_type: {
      'docs-only': 'L0',
      'surgical-fix': 'L1',
      bugfix: 'L1',
      feature: 'L2',
      refactor: 'L3',
      migration: 'L5',
      exploration: 'L0',
      incident: 'L3'
    },
    by_path: [
      {
        pattern: 'auth/**',
        min_verification: 'L5',
        required_skills: ['security-tripwire'],
        required_commands: []
      }
    ]
  },
  ci: {
    provider: 'github-actions',
    required_checks: ['pnpm test', 'pnpm typecheck', 'pnpm lint', 'pnpm build']
  }
};

export function renderDefaultPolicyGate(config?: KernelConfig): string {
  const policy = mergeRiskIntoPolicy(DEFAULT_POLICY_GATE, config);
  return stringifyYaml(policy);
}

export function mergeRiskIntoPolicy(policy: PolicyGate, config?: KernelConfig): PolicyGate {
  if (!config) {
    return policy;
  }

  const existingMatches = new Set(policy.commands.map((rule) => rule.match));
  const riskCommands = config.risk.destructive_commands
    .filter((match) => !existingMatches.has(match))
    .map((match) => ({
      class: 'block' as const,
      match,
      reason: `configured destructive command: ${match}`
    }));

  const existingPatterns = new Set(policy.paths.map((rule) => rule.pattern));
  const riskPaths = config.risk.high_risk_paths
    .filter((pattern) => !existingPatterns.has(pattern))
    .map((pattern) => ({
      pattern,
      class: 'review' as const,
      reason: 'configured high-risk path',
      min_verification: 'L3' as const,
      required_skills: ['verify-lattice']
    }));

  return {
    ...policy,
    commands: [...policy.commands, ...riskCommands],
    paths: [...policy.paths, ...riskPaths]
  };
}
