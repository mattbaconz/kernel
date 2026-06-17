export const CONTEXT_PROVIDER_IDS = ['github-pr', 'github-issue'] as const;

export type ContextProviderId = (typeof CONTEXT_PROVIDER_IDS)[number];

export const CONTEXT_ERROR_CODES = [
  'missing_github_repo',
  'github_api_error',
  'pr_not_found',
  'issue_not_found',
  'current_pr_not_found',
  'invalid_context_request'
] as const;

export type ContextErrorCode = (typeof CONTEXT_ERROR_CODES)[number];

export interface ContextError {
  code: ContextErrorCode;
  message: string;
}

export interface ContextResult<T extends object> {
  provider: ContextProviderId;
  status: 'ok' | 'error';
  data?: T;
  error?: ContextError;
  cachedPath?: string;
}

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface PrChangedFile {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface PrCheckSummary {
  state: 'success' | 'failure' | 'pending' | 'unknown';
  total: number;
  passing: number;
  failing: number;
  pending: number;
}

export interface PrContextData {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  changedFiles: PrChangedFile[];
  checks: PrCheckSummary;
  url: string;
}

export interface IssueContextData {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  assignees: string[];
  linkedReferences: string[];
  url: string;
}

export class KernelContextError extends Error {
  constructor(
    message: string,
    readonly code: ContextErrorCode,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'KernelContextError';
  }
}
