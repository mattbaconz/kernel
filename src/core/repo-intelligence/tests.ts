import { basename } from 'node:path';

import type { CommandEntry, TestFramework } from './types.js';
import { compareCommandEntries, compareStrings } from './utils.js';

const TEST_CONFIG_PATTERNS = [
  /^vitest\.config\.[cm]?[jt]sx?$/,
  /^jest\.config\.[cm]?[jt]sx?$/,
  /^playwright\.config\.[cm]?[jt]sx?$/,
  /^cypress\.config\.[cm]?[jt]sx?$/,
  /^mocha\.opts$/
] as const;

const E2E_DIRECTORY_NAMES = ['e2e', 'playwright', 'cypress'] as const;

const TEST_FILE_PATTERNS = [
  'tests/**',
  'test/**',
  '__tests__/**',
  '**/*.test.[cm]?[jt]sx?',
  '**/*.spec.[cm]?[jt]sx?',
  '**/*.e2e.[cm]?[jt]sx?'
] as const;

export interface DetectTestsResult {
  testFiles: string[];
  testCommands: CommandEntry[];
  frameworks: TestFramework[];
  configFiles: string[];
  e2ePaths: string[];
  patterns: string[];
}

export function detectTests(filePaths: string[], scripts: CommandEntry[]): DetectTestsResult {
  const testFiles = filePaths.filter(isTestFile).sort(compareStrings);
  const testCommands = scripts.filter((script) => script.name.includes('test')).sort(compareCommandEntries);
  const configFiles = filePaths.filter(isTestConfigFile).sort(compareStrings);
  const e2ePaths = detectE2ePaths(filePaths);
  const frameworks = detectFrameworks(filePaths, scripts, configFiles);

  return {
    testFiles,
    testCommands,
    frameworks: frameworks.sort(compareStrings) as TestFramework[],
    configFiles,
    e2ePaths,
    patterns: [...TEST_FILE_PATTERNS]
  };
}

export function isTestFile(path: string): boolean {
  const fileName = basename(path);
  return (
    path.includes('/__tests__/') ||
    path.startsWith('tests/') ||
    path.startsWith('test/') ||
    /\.test\.[cm]?[jt]sx?$/.test(fileName) ||
    /\.spec\.[cm]?[jt]sx?$/.test(fileName) ||
    /\.e2e\.[cm]?[jt]sx?$/.test(fileName)
  );
}

function isTestConfigFile(path: string): boolean {
  const fileName = basename(path);
  return TEST_CONFIG_PATTERNS.some((pattern) => pattern.test(fileName));
}

function detectE2ePaths(filePaths: string[]): string[] {
  const paths = new Set<string>();
  for (const filePath of filePaths) {
    for (const dirName of E2E_DIRECTORY_NAMES) {
      if (filePath === dirName || filePath.startsWith(`${dirName}/`)) {
        paths.add(dirName);
      }
    }
  }
  return [...paths].sort(compareStrings);
}

function detectFrameworks(
  filePaths: string[],
  scripts: CommandEntry[],
  configFiles: string[]
): TestFramework[] {
  const frameworks = new Set<TestFramework>();
  const haystack = [...filePaths, ...scripts.map((script) => script.script), ...configFiles].join('\n').toLowerCase();

  if (haystack.includes('vitest') || configFiles.some((file) => file.includes('vitest.config'))) {
    frameworks.add('vitest');
  }
  if (haystack.includes('jest') || configFiles.some((file) => file.includes('jest.config'))) {
    frameworks.add('jest');
  }
  if (haystack.includes('playwright') || configFiles.some((file) => file.includes('playwright.config'))) {
    frameworks.add('playwright');
  }
  if (haystack.includes('cypress') || configFiles.some((file) => file.includes('cypress.config'))) {
    frameworks.add('cypress');
  }
  if (haystack.includes('mocha') || configFiles.some((file) => file.includes('mocha.opts'))) {
    frameworks.add('mocha');
  }

  return [...frameworks];
}
