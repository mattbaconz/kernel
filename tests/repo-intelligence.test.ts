import { describe, expect, test } from 'vitest';

import { parseCodeowners } from '../src/core/repo-intelligence/codeowners.js';
import { matchGlob } from '../src/core/repo-intelligence/glob.js';

describe('matchGlob', () => {
  test('matches single-segment wildcards', () => {
    expect(matchGlob('src/*.ts', 'src/index.ts')).toBe(true);
    expect(matchGlob('src/*.ts', 'src/lib/index.ts')).toBe(false);
  });

  test('matches recursive directory patterns', () => {
    expect(matchGlob('src/core/**', 'src/core/maps.ts')).toBe(true);
    expect(matchGlob('src/core/**', 'src/core')).toBe(true);
    expect(matchGlob('src/core/**', 'src/other/maps.ts')).toBe(false);
  });
});

describe('parseCodeowners', () => {
  test('parses owner tokens and ignores comments', () => {
    const rules = parseCodeowners(
      ['# team ownership', '/src/auth/ @security-team @platform-leads', ''].join('\n'),
      '.github/CODEOWNERS'
    );

    expect(rules).toEqual([
      {
        pattern: 'src/auth/',
        owners: ['@platform-leads', '@security-team'],
        source: '.github/CODEOWNERS'
      }
    ]);
  });
});
