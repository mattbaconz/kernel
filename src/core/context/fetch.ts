import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadKernelConfig } from '../config.js';
import { formatKernelJsonResult } from '../json-output.js';
import {
  createGitHubApiClient,
  resolveCurrentPullRequestNumber,
  resolveGitHubRepo,
  type GitHubApiClient
} from './github.js';
import { fetchIssueContext } from './issue.js';
import { fetchPrContext } from './pr.js';
import type { ContextResult, IssueContextData, PrContextData } from './types.js';
import { KernelContextError } from './types.js';

export interface ContextFetchOptions {
  kind: 'pr' | 'issue';
  number?: number;
  current?: boolean;
  rootDir?: string;
  dryRun?: boolean;
  apiClient?: GitHubApiClient;
}

export async function fetchContext(options: ContextFetchOptions): Promise<ContextResult<PrContextData | IssueContextData>> {
  const rootDir = options.rootDir ?? process.cwd();
  const config = await loadKernelConfig(rootDir);
  const repo = await resolveGitHubRepo({ rootDir, config });
  const apiClient = createGitHubApiClient({ apiClient: options.apiClient });

  let number = options.number;
  if (options.current || number === undefined) {
    if (options.kind !== 'pr') {
      throw new KernelContextError('Issue context requires --number.', 'invalid_context_request');
    }

    number = await resolveCurrentPullRequestNumber(rootDir, repo, apiClient);
  }

  if (number === undefined) {
    throw new KernelContextError(`${options.kind} context requires --number or --current.`, 'invalid_context_request');
  }

  const result =
    options.kind === 'pr'
      ? await fetchPrContext({ repo, number, apiClient })
      : await fetchIssueContext({ repo, number, apiClient });

  if (result.status === 'ok' && result.data && !options.dryRun) {
    result.cachedPath = await writeContextCache(rootDir, options.kind, number, result.data, config.canonical.agent_dir);
  }

  return result;
}

export function formatContextResult(result: ContextResult<PrContextData | IssueContextData>): string {
  if (result.status === 'error') {
    return `Context error (${result.error?.code}): ${result.error?.message}`;
  }

  const data = result.data;
  if (!data) {
    return 'Context loaded.';
  }

  if ('changedFiles' in data) {
    const lines = [
      `PR #${data.number}: ${data.title}`,
      `State: ${data.state}`,
      `Labels: ${data.labels.join(', ') || '(none)'}`,
      `Checks: ${data.checks.state} (${data.checks.passing}/${data.checks.total} passing)`,
      `Changed files: ${data.changedFiles.length}`,
      data.url
    ];
    if (result.cachedPath) {
      lines.push(`Cached: ${result.cachedPath}`);
    }
    return lines.join('\n');
  }

  const lines = [
    `Issue #${data.number}: ${data.title}`,
    `State: ${data.state}`,
    `Labels: ${data.labels.join(', ') || '(none)'}`,
    `Assignees: ${data.assignees.join(', ') || '(none)'}`,
    `Linked references: ${data.linkedReferences.join(', ') || '(none)'}`,
    data.url
  ];
  if (result.cachedPath) {
    lines.push(`Cached: ${result.cachedPath}`);
  }
  return lines.join('\n');
}

export function formatContextJsonResult(result: ContextResult<PrContextData | IssueContextData>): string {
  return formatKernelJsonResult(result);
}

async function writeContextCache(
  rootDir: string,
  kind: 'pr' | 'issue',
  number: number,
  data: PrContextData | IssueContextData,
  agentDir: string
): Promise<string> {
  const contextDir = join(rootDir, agentDir, 'context');
  await mkdir(contextDir, { recursive: true });
  const relativePath = join(agentDir, 'context', `${kind}-${number}.json`);
  const absolutePath = join(rootDir, relativePath);
  await writeFile(absolutePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return relativePath.replace(/\\/g, '/');
}
