import type { KernelConfig } from '../config.js';
import { findLastMatchingRule, matchGlob } from './glob.js';
import type {
  CodeownersRule,
  CommandEntry,
  ConfigRiskPathEntry,
  OwnershipEntry,
  RiskCommandEntry,
  RiskPathEntry
} from './types.js';
import { compareCommandEntries, compareStrings } from './utils.js';

export interface InferRiskOptions {
  filePaths: string[];
  scripts: CommandEntry[];
  ignoredDirectories: string[];
  config: KernelConfig;
  codeownersRules: CodeownersRule[];
}

export interface InferRiskResult {
  highRiskPaths: RiskPathEntry[];
  destructiveCommands: RiskCommandEntry[];
  ownership: OwnershipEntry[];
  configRiskPaths: ConfigRiskPathEntry[];
}

export function inferRisk(options: InferRiskOptions): InferRiskResult {
  const inferredPaths = options.filePaths.flatMap(classifyHighRiskPath).sort(compareRiskPaths);
  const configRiskPaths = buildConfigRiskPaths(options.config);
  const configMatchedPaths = matchConfigRiskPaths(options.filePaths, configRiskPaths);
  const ownership = buildOwnership(options.filePaths, options.codeownersRules, options.config.maps.include_codeowners);
  const ownedRiskPaths = ownership
    .filter((entry) => !hasRiskPath(inferredPaths, entry.path) && !hasRiskPath(configMatchedPaths, entry.path))
    .map((entry) => ({ path: entry.path, reason: 'owned path' }));

  const highRiskPaths = dedupeRiskPaths([...inferredPaths, ...configMatchedPaths, ...ownedRiskPaths]).sort(compareRiskPaths);
  const destructiveCommands = dedupeRiskCommands([
    ...options.scripts.flatMap(classifyDestructiveCommand),
    ...classifyConfigDestructiveCommands(options.scripts, options.config)
  ]).sort(compareRiskCommands);

  return {
    highRiskPaths,
    destructiveCommands,
    ownership: ownership.sort(compareOwnership),
    configRiskPaths: configRiskPaths.sort((left, right) => compareStrings(left.pattern, right.pattern))
  };
}

function buildConfigRiskPaths(config: KernelConfig): ConfigRiskPathEntry[] {
  return config.risk.high_risk_paths.map((pattern) => ({
    pattern,
    reason: 'configured high-risk path'
  }));
}

function matchConfigRiskPaths(filePaths: string[], configRiskPaths: ConfigRiskPathEntry[]): RiskPathEntry[] {
  const matches: RiskPathEntry[] = [];
  for (const filePath of filePaths) {
    for (const configRiskPath of configRiskPaths) {
      if (matchGlob(configRiskPath.pattern, filePath)) {
        matches.push({ path: filePath, reason: configRiskPath.reason });
      }
    }
  }
  return matches;
}

function buildOwnership(filePaths: string[], rules: CodeownersRule[], includeCodeowners: boolean): OwnershipEntry[] {
  if (!includeCodeowners || rules.length === 0) {
    return [];
  }

  const ownership: OwnershipEntry[] = [];
  for (const filePath of filePaths) {
    const match = findLastMatchingRule(filePath, rules);
    if (!match) {
      continue;
    }
    ownership.push({
      path: filePath,
      owners: [...match.owners],
      source: 'codeowners'
    });
  }
  return ownership;
}

function classifyHighRiskPath(path: string): RiskPathEntry[] {
  if (path.startsWith('.github/workflows/')) {
    return [{ path, reason: 'CI workflow' }];
  }
  if (path.startsWith('db/migrations/')) {
    return [{ path, reason: 'database migration' }];
  }
  if (path.startsWith('infra/')) {
    return [{ path, reason: 'infrastructure' }];
  }
  if (path.startsWith('auth/') || path.includes('/auth/')) {
    return [{ path, reason: 'authentication' }];
  }
  if (path.startsWith('billing/') || path.includes('/billing/')) {
    return [{ path, reason: 'billing' }];
  }

  return [];
}

function classifyDestructiveCommand(command: CommandEntry): RiskCommandEntry[] {
  const script = command.script;
  if (script.includes('npm publish') || script.includes('pnpm publish')) {
    return [{ ...command, reason: 'package publishing' }];
  }
  if (script.includes('git push --force')) {
    return [{ ...command, reason: 'force push' }];
  }
  if (script.includes('git reset --hard')) {
    return [{ ...command, reason: 'destructive git reset' }];
  }
  if (script.includes('rm -rf')) {
    return [{ ...command, reason: 'recursive deletion' }];
  }

  return [];
}

function classifyConfigDestructiveCommands(scripts: CommandEntry[], config: KernelConfig): RiskCommandEntry[] {
  const matches: RiskCommandEntry[] = [];
  for (const command of scripts) {
    for (const pattern of config.risk.destructive_commands) {
      if (command.script.includes(pattern) || command.command.includes(pattern)) {
        matches.push({ ...command, reason: `matches configured destructive command: ${pattern}` });
      }
    }
  }
  return matches;
}

function hasRiskPath(entries: RiskPathEntry[], path: string): boolean {
  return entries.some((entry) => entry.path === path);
}

function dedupeRiskPaths(entries: RiskPathEntry[]): RiskPathEntry[] {
  const seen = new Set<string>();
  const deduped: RiskPathEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.path)) {
      continue;
    }
    seen.add(entry.path);
    deduped.push(entry);
  }
  return deduped;
}

function dedupeRiskCommands(entries: RiskCommandEntry[]): RiskCommandEntry[] {
  const seen = new Set<string>();
  const deduped: RiskCommandEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.name}:${entry.reason}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function compareRiskPaths(left: RiskPathEntry, right: RiskPathEntry): number {
  return compareStrings(left.path, right.path);
}

function compareRiskCommands(left: RiskCommandEntry, right: RiskCommandEntry): number {
  return compareCommandEntries(left, right);
}

function compareOwnership(left: OwnershipEntry, right: OwnershipEntry): number {
  return compareStrings(left.path, right.path);
}
