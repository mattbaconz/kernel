export interface CommandEntry {
  name: string;
  command: string;
  script: string;
}

export type CommandSource = 'package.json' | 'makefile' | 'justfile' | 'kernel.yaml' | 'turbo' | 'nx';

export interface PackageScriptsEntry {
  package: string;
  path: string;
  scripts: CommandEntry[];
}

export interface TaskRunnerTask {
  name: string;
  command: string;
  source: string;
}

export interface RepoFileEntry {
  path: string;
  sizeBytes: number;
}

export interface WorkspacePackage {
  name: string;
  path: string;
  private?: boolean;
}

export interface MonorepoInfo {
  tool: 'pnpm' | 'npm' | 'yarn' | null;
  workspaceFile: string | null;
}

export interface EntrypointEntry {
  path: string;
  kind: 'main' | 'module' | 'bin' | 'types';
}

export type TestFramework = 'vitest' | 'jest' | 'playwright' | 'cypress' | 'mocha';

export interface RiskPathEntry {
  path: string;
  reason: string;
}

export interface RiskCommandEntry extends CommandEntry {
  reason: string;
}

export interface OwnershipEntry {
  path: string;
  owners: string[];
  source: 'codeowners' | 'config' | 'inferred';
}

export interface ConfigRiskPathEntry {
  pattern: string;
  reason: string;
}

export interface CodeownersRule {
  pattern: string;
  owners: string[];
  source: string;
}
