import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';

import type { KernelConfig } from '../config.js';
import { DEFAULT_POLICY_GATE, mergeRiskIntoPolicy } from './defaults.js';
import { type PolicyGate, policyGateSchema } from './schema.js';

export const POLICY_GATE_FILE = join('.agent', 'policies', 'policy-gate.yaml');

export class KernelPolicyError extends Error {
  constructor(
    message: string,
    readonly policyPath: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'KernelPolicyError';
  }
}

export interface LoadedPolicies {
  policyGate: PolicyGate;
  sourceFiles: string[];
}

export async function loadPolicies(rootDir: string, config?: KernelConfig): Promise<LoadedPolicies> {
  const policiesDir = join(rootDir, '.agent', 'policies');
  const sourceFiles: string[] = [];

  if (!(await pathExists(policiesDir))) {
    return {
      policyGate: mergeRiskIntoPolicy(DEFAULT_POLICY_GATE, config),
      sourceFiles
    };
  }

  const entries = await readdir(policiesDir);
  const yamlFiles = entries.filter((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml')).sort();

  if (yamlFiles.length === 0) {
    return {
      policyGate: mergeRiskIntoPolicy(DEFAULT_POLICY_GATE, config),
      sourceFiles
    };
  }

  let mergedPolicy: PolicyGate | undefined;
  for (const fileName of yamlFiles) {
    const relativePath = join('.agent', 'policies', fileName);
    const absolutePath = join(rootDir, relativePath);
    sourceFiles.push(relativePath.replace(/\\/g, '/'));
    const parsed = await parsePolicyFile(absolutePath, relativePath.replace(/\\/g, '/'));
    mergedPolicy = mergedPolicy ? mergePolicyFiles(mergedPolicy, parsed) : parsed;
  }

  return {
    policyGate: mergeRiskIntoPolicy(mergedPolicy ?? DEFAULT_POLICY_GATE, config),
    sourceFiles
  };
}

export async function hasPolicyFiles(rootDir: string): Promise<boolean> {
  const policiesDir = join(rootDir, '.agent', 'policies');
  if (!(await pathExists(policiesDir))) {
    return false;
  }

  const entries = await readdir(policiesDir);
  return entries.some((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml'));
}

async function parsePolicyFile(absolutePath: string, relativePath: string): Promise<PolicyGate> {
  let parsed: unknown;
  try {
    parsed = parseYaml(await readFile(absolutePath, 'utf8')) ?? {};
  } catch (error) {
    throw new KernelPolicyError(`Failed to parse ${relativePath} as YAML.`, relativePath, { cause: error });
  }

  const result = policyGateSchema.safeParse(parsed);
  if (!result.success) {
    throw new KernelPolicyError(`Invalid policy in ${relativePath}.`, relativePath, { cause: result.error });
  }

  return result.data;
}

function mergePolicyFiles(left: PolicyGate, right: PolicyGate): PolicyGate {
  return {
    version: 1,
    commands: dedupeCommandRules([...left.commands, ...right.commands]),
    paths: dedupePathRules([...left.paths, ...right.paths]),
    escalation: {
      by_task_type: { ...left.escalation.by_task_type, ...right.escalation.by_task_type },
      by_path: dedupeEscalationRules([...left.escalation.by_path, ...right.escalation.by_path])
    },
    ci: {
      provider: right.ci.provider ?? left.ci.provider,
      required_checks: [...new Set([...left.ci.required_checks, ...right.ci.required_checks])].sort()
    }
  };
}

function dedupeCommandRules(rules: PolicyGate['commands']): PolicyGate['commands'] {
  const seen = new Set<string>();
  const deduped: PolicyGate['commands'] = [];
  for (const rule of rules) {
    const key = `${rule.class}:${rule.match}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(rule);
  }
  return deduped;
}

function dedupePathRules(rules: PolicyGate['paths']): PolicyGate['paths'] {
  const seen = new Set<string>();
  const deduped: PolicyGate['paths'] = [];
  for (const rule of rules) {
    if (seen.has(rule.pattern)) {
      continue;
    }
    seen.add(rule.pattern);
    deduped.push(rule);
  }
  return deduped;
}

function dedupeEscalationRules(rules: PolicyGate['escalation']['by_path']): PolicyGate['escalation']['by_path'] {
  const seen = new Set<string>();
  const deduped: PolicyGate['escalation']['by_path'] = [];
  for (const rule of rules) {
    if (seen.has(rule.pattern)) {
      continue;
    }
    seen.add(rule.pattern);
    deduped.push(rule);
  }
  return deduped;
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
