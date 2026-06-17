export function matchGlob(pattern: string, filePath: string): boolean {
  return matchPathPattern(pattern, filePath);
}

export function matchPathPattern(pattern: string, filePath: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(filePath);

  if (pattern.endsWith('/')) {
    return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
  }

  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }

  return globToRegExp(normalizedPattern).test(normalizedPath);
}

export function findLastMatchingRule<T extends { pattern: string }>(
  filePath: string,
  rules: T[]
): T | undefined {
  let match: T | undefined;
  for (const rule of rules) {
    if (matchPathPattern(rule.pattern, filePath)) {
      match = rule;
    }
  }
  return match;
}

function globToRegExp(pattern: string): RegExp {
  let regex = '^';
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        regex += '(?:.*/)?';
        index += 3;
        continue;
      }
      regex += '.*';
      index += 2;
      continue;
    }
    if (char === '*') {
      regex += '[^/]*';
      index += 1;
      continue;
    }
    if (char === '?') {
      regex += '[^/]';
      index += 1;
      continue;
    }
    regex += escapeRegExpChar(char);
    index += 1;
  }

  return new RegExp(`${regex}$`);
}

function escapeRegExpChar(char: string): string {
  return /[$()*+.?[\\\]^{|}]/.test(char) ? `\\${char}` : char;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
}
