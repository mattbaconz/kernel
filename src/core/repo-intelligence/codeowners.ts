import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CodeownersRule } from './types.js';
import { compareStrings, pathExists } from './utils.js';

const CODEOWNERS_LOCATIONS = ['CODEOWNERS', join('.github', 'CODEOWNERS'), join('docs', 'CODEOWNERS')] as const;

export async function loadCodeownersRules(rootDir: string): Promise<CodeownersRule[]> {
  const rules: CodeownersRule[] = [];

  for (const relativePath of CODEOWNERS_LOCATIONS) {
    const absolutePath = join(rootDir, relativePath);
    if (!(await pathExists(absolutePath))) {
      continue;
    }
    const content = await readFile(absolutePath, 'utf8');
    rules.push(...parseCodeowners(content, relativePath.replace(/\\/g, '/')));
  }

  return rules;
}

export function parseCodeowners(content: string, source: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) {
      continue;
    }

    const tokens = line.split(/\s+/);
    const pattern = tokens[0];
    const owners = tokens.slice(1).filter((token) => token.startsWith('@'));
    if (!pattern || owners.length === 0) {
      continue;
    }

    rules.push({
      pattern: pattern.replace(/\\/g, '/').replace(/^\//, ''),
      owners: owners.sort(compareStrings),
      source
    });
  }

  return rules;
}

function stripComment(line: string): string {
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '#') {
      return line.slice(0, index);
    }
  }
  return line;
}
