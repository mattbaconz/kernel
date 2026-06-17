import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { KernelConfig } from '../config.js';
import { KernelContextError } from './types.js';
import type { GitHubRepoRef } from './types.js';

const execFileAsync = promisify(execFile);

export type GitHubApiClient = (endpoint: string) => Promise<unknown>;

export interface ResolveGitHubRepoOptions {
  rootDir?: string;
  config?: KernelConfig;
}

export async function resolveGitHubRepo(options: ResolveGitHubRepoOptions = {}): Promise<GitHubRepoRef> {
  const rootDir = options.rootDir ?? process.cwd();
  const configOwner = options.config?.context?.github?.owner;
  const configRepo = options.config?.context?.github?.repo;

  if (configOwner && configRepo) {
    return { owner: configOwner, repo: configRepo };
  }

  const remote = await resolveOriginRemote(rootDir);
  if (!remote) {
    throw new KernelContextError(
      'Could not resolve GitHub owner/repo from kernel.yaml context.github or git remote origin.',
      'missing_github_repo'
    );
  }

  return {
    owner: configOwner ?? remote.owner,
    repo: configRepo ?? remote.repo
  };
}

export function createGitHubApiClient(options: { apiClient?: GitHubApiClient } = {}): GitHubApiClient {
  if (options.apiClient) {
    return options.apiClient;
  }

  return async (endpoint: string) => {
    try {
      return await ghApi(endpoint);
    } catch (ghError) {
      const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
      if (!token) {
        throw ghError;
      }

      return githubFetch(endpoint, token);
    }
  };
}

export async function resolveCurrentPullRequestNumber(
  rootDir: string,
  repo: GitHubRepoRef,
  apiClient: GitHubApiClient
): Promise<number> {
  try {
    const { stdout } = await execFileAsync('gh', ['pr', 'view', '--json', 'number'], {
      cwd: rootDir,
      encoding: 'utf8'
    });
    const parsed = JSON.parse(stdout) as { number?: number };
    if (typeof parsed.number === 'number') {
      return parsed.number;
    }
  } catch {
    // Fall through to branch-based lookup.
  }

  const branch = await readCurrentBranch(rootDir);
  if (!branch) {
    throw new KernelContextError('Could not resolve the current pull request from gh or git branch.', 'current_pr_not_found');
  }

  const response = (await apiClient(
    `/repos/${repo.owner}/${repo.repo}/pulls?head=${repo.owner}:${branch}&state=open`
  )) as Array<{ number: number }>;

  const pullRequest = response[0];
  if (!pullRequest) {
    throw new KernelContextError(`No open pull request found for branch ${branch}.`, 'current_pr_not_found');
  }

  return pullRequest.number;
}

async function ghApi(endpoint: string): Promise<unknown> {
  const path = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const { stdout } = await execFileAsync('gh', ['api', path], { encoding: 'utf8' });
  return JSON.parse(stdout) as unknown;
}

async function githubFetch(endpoint: string, token: string): Promise<unknown> {
  const url = endpoint.startsWith('http') ? endpoint : `https://api.github.com${endpoint}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!response.ok) {
    throw new KernelContextError(
      `GitHub API request failed (${response.status} ${response.statusText}).`,
      'github_api_error'
    );
  }

  return response.json() as Promise<unknown>;
}

async function resolveOriginRemote(rootDir: string): Promise<GitHubRepoRef | null> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: rootDir,
      encoding: 'utf8'
    });
    return parseGitHubRemote(stdout.trim());
  } catch {
    const config = await readFile(join(rootDir, '.git', 'config'), 'utf8').catch(() => null);
    if (!config) {
      return null;
    }

    const match = config.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(.+)/);
    return match ? parseGitHubRemote(match[1].trim()) : null;
  }
}

export function parseGitHubRemote(remoteUrl: string): GitHubRepoRef | null {
  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  const httpsMatch = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  return null;
}

async function readCurrentBranch(rootDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8'
    });
    const branch = stdout.trim();
    return branch === 'HEAD' ? null : branch;
  } catch {
    return null;
  }
}
