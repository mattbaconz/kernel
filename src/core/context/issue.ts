import type { GitHubApiClient } from './github.js';
import type { ContextResult, IssueContextData } from './types.js';
import { KernelContextError } from './types.js';
import type { GitHubRepoRef } from './types.js';

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
}

interface GitHubTimelineEvent {
  event: string;
  source?: {
    issue?: {
      number: number;
    };
  };
}

export interface FetchIssueContextOptions {
  repo: GitHubRepoRef;
  number: number;
  apiClient: GitHubApiClient;
}

export async function fetchIssueContext(options: FetchIssueContextOptions): Promise<ContextResult<IssueContextData>> {
  const { repo, number, apiClient } = options;
  const basePath = `/repos/${repo.owner}/${repo.repo}`;

  try {
    const issue = (await apiClient(`${basePath}/issues/${number}`)) as GitHubIssue;
    const timeline = (await apiClient(`${basePath}/issues/${number}/timeline`)) as GitHubTimelineEvent[];

    return {
      provider: 'github-issue',
      status: 'ok',
      data: {
        number: issue.number,
        title: issue.title,
        body: issue.body ?? '',
        state: issue.state,
        labels: issue.labels.map((label) => label.name),
        assignees: issue.assignees.map((assignee) => assignee.login),
        linkedReferences: extractLinkedReferences(issue.body ?? '', timeline),
        url: issue.html_url
      }
    };
  } catch (error) {
    if (error instanceof KernelContextError) {
      return errorResult(error);
    }

    return errorResult(
      new KernelContextError(`Issue #${number} could not be loaded.`, 'issue_not_found', { cause: error })
    );
  }
}

function extractLinkedReferences(body: string, timeline: GitHubTimelineEvent[]): string[] {
  const references = new Set<string>();

  for (const match of body.matchAll(/#(\d+)/g)) {
    references.add(`#${match[1]}`);
  }

  for (const event of timeline) {
    if (event.event === 'cross-referenced' && event.source?.issue?.number) {
      references.add(`#${event.source.issue.number}`);
    }
  }

  return [...references].sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
}

function errorResult(error: KernelContextError): ContextResult<IssueContextData> {
  return {
    provider: 'github-issue',
    status: 'error',
    error: {
      code: error.code,
      message: error.message
    }
  };
}
