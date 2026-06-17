import type { GitHubApiClient } from './github.js';
import type { ContextResult, PrCheckSummary, PrContextData } from './types.js';
import { KernelContextError } from './types.js';
import type { GitHubRepoRef } from './types.js';

interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  labels: Array<{ name: string }>;
  head: { sha: string };
}

interface GitHubPullFile {
  filename: string;
  additions: number;
  deletions: number;
  status: string;
}

interface GitHubCheckRun {
  status: string;
  conclusion: string | null;
}

export interface FetchPrContextOptions {
  repo: GitHubRepoRef;
  number: number;
  apiClient: GitHubApiClient;
}

export async function fetchPrContext(options: FetchPrContextOptions): Promise<ContextResult<PrContextData>> {
  const { repo, number, apiClient } = options;
  const basePath = `/repos/${repo.owner}/${repo.repo}`;

  try {
    const pullRequest = (await apiClient(`${basePath}/pulls/${number}`)) as GitHubPullRequest;
    const files = (await apiClient(`${basePath}/pulls/${number}/files`)) as GitHubPullFile[];
    const checks = await fetchCheckSummary(apiClient, basePath, pullRequest.head.sha);

    return {
      provider: 'github-pr',
      status: 'ok',
      data: {
        number: pullRequest.number,
        title: pullRequest.title,
        body: pullRequest.body ?? '',
        state: pullRequest.state,
        labels: pullRequest.labels.map((label) => label.name),
        changedFiles: files.map((file) => ({
          path: file.filename,
          additions: file.additions,
          deletions: file.deletions,
          status: file.status
        })),
        checks,
        url: pullRequest.html_url
      }
    };
  } catch (error) {
    if (error instanceof KernelContextError) {
      return errorResult(error);
    }

    return errorResult(
      new KernelContextError(`Pull request #${number} could not be loaded.`, 'pr_not_found', { cause: error })
    );
  }
}

async function fetchCheckSummary(
  apiClient: GitHubApiClient,
  basePath: string,
  headSha: string
): Promise<PrCheckSummary> {
  try {
    const checkRuns = (await apiClient(`${basePath}/commits/${headSha}/check-runs`)) as {
      check_runs: GitHubCheckRun[];
    };

    const runs = checkRuns.check_runs ?? [];
    const passing = runs.filter((run) => run.conclusion === 'success').length;
    const failing = runs.filter((run) => run.conclusion === 'failure' || run.conclusion === 'cancelled').length;
    const pending = runs.filter((run) => run.status !== 'completed').length;

    let state: PrCheckSummary['state'] = 'unknown';
    if (runs.length === 0) {
      state = 'unknown';
    } else if (failing > 0) {
      state = 'failure';
    } else if (pending > 0) {
      state = 'pending';
    } else if (passing === runs.length) {
      state = 'success';
    }

    return {
      state,
      total: runs.length,
      passing,
      failing,
      pending
    };
  } catch {
    return {
      state: 'unknown',
      total: 0,
      passing: 0,
      failing: 0,
      pending: 0
    };
  }
}

function errorResult(error: KernelContextError): ContextResult<PrContextData> {
  return {
    provider: 'github-pr',
    status: 'error',
    error: {
      code: error.code,
      message: error.message
    }
  };
}
