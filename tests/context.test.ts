import { readFile } from 'node:fs/promises';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { fetchContext } from '../src/core/context/fetch.js';
import type { GitHubApiClient } from '../src/core/context/github.js';
import { fetchIssueContext } from '../src/core/context/issue.js';
import { fetchPrContext } from '../src/core/context/pr.js';

const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-context-${name}-`));
  tempDirs.push(dir);
  await cp(join(process.cwd(), 'tests', 'fixtures', name), dir, { recursive: true });
  return dir;
}

async function readFixtureJson<T>(fixture: string, fileName: string): Promise<T> {
  const raw = await readFile(join(process.cwd(), 'tests', 'fixtures', fixture, fileName), 'utf8');
  return JSON.parse(raw) as T;
}

function createFixtureApiClient(fixture: 'context-pr' | 'context-issue'): GitHubApiClient {
  return async (endpoint: string) => {
    if (fixture === 'context-pr') {
      if (endpoint.endsWith('/pulls/42')) {
        return readFixtureJson('context-pr', 'pull.json');
      }
      if (endpoint.endsWith('/pulls/42/files')) {
        return readFixtureJson('context-pr', 'files.json');
      }
      if (endpoint.endsWith('/check-runs')) {
        return readFixtureJson('context-pr', 'checks.json');
      }
    }

    if (fixture === 'context-issue') {
      if (endpoint.endsWith('/issues/15')) {
        return readFixtureJson('context-issue', 'issue.json');
      }
      if (endpoint.endsWith('/issues/15/timeline')) {
        return readFixtureJson('context-issue', 'timeline.json');
      }
    }

    throw new Error(`Unexpected endpoint: ${endpoint}`);
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('fetchPrContext', () => {
  test('returns structured PR context from mocked GitHub API', async () => {
    const result = await fetchPrContext({
      repo: { owner: 'mattbaconz', repo: 'kernel' },
      number: 42,
      apiClient: createFixtureApiClient('context-pr')
    });

    expect(result.status).toBe('ok');
    expect(result.data?.number).toBe(42);
    expect(result.data?.labels).toEqual(['enhancement']);
    expect(result.data?.changedFiles).toHaveLength(2);
    expect(result.data?.checks).toEqual({
      state: 'failure',
      total: 3,
      passing: 2,
      failing: 1,
      pending: 0
    });
  });
});

describe('fetchIssueContext', () => {
  test('returns structured issue context with linked references', async () => {
    const result = await fetchIssueContext({
      repo: { owner: 'mattbaconz', repo: 'kernel' },
      number: 15,
      apiClient: createFixtureApiClient('context-issue')
    });

    expect(result.status).toBe('ok');
    expect(result.data?.assignees).toEqual(['mattbaconz']);
    expect(result.data?.linkedReferences).toEqual(['#12', '#18']);
  });
});

describe('fetchContext', () => {
  test('writes PR cache under .agent/context when not dry-run', async () => {
    const rootDir = await copyFixture('context-pr');

    const result = await fetchContext({
      kind: 'pr',
      number: 42,
      rootDir,
      apiClient: createFixtureApiClient('context-pr')
    });

    expect(result.cachedPath).toBe('.agent/context/pr-42.json');
    const cached = JSON.parse(await readFile(join(rootDir, '.agent', 'context', 'pr-42.json'), 'utf8')) as {
      title: string;
    };
    expect(cached.title).toContain('GitHub context');
  });

  test('skips cache write on dry-run', async () => {
    const rootDir = await copyFixture('context-issue');

    const result = await fetchContext({
      kind: 'issue',
      number: 15,
      rootDir,
      dryRun: true,
      apiClient: createFixtureApiClient('context-issue')
    });

    expect(result.cachedPath).toBeUndefined();
    await expect(readFile(join(rootDir, '.agent', 'context', 'issue-15.json'), 'utf8')).rejects.toThrow();
  });
});
