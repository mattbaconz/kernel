import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { PolicyGate } from './schema.js';
import { extractWorkflowRunCommands } from './escalation.js';
import type { CiCheckResult } from './types.js';

export async function checkCiPolicy(rootDir: string, policy: PolicyGate): Promise<CiCheckResult> {
  const workflowsDir = join(rootDir, '.github', 'workflows');
  if (!(await pathExists(workflowsDir))) {
    return {
      provider: null,
      requiredChecks: policy.ci.required_checks,
      foundChecks: [],
      missingChecks: []
    };
  }

  const entries = await readdir(workflowsDir);
  const workflowFiles = entries.filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml')).sort();
  const foundChecks = new Set<string>();

  for (const fileName of workflowFiles) {
    const commands = await extractWorkflowRunCommands(join(workflowsDir, fileName));
    for (const command of commands) {
      foundChecks.add(command);
    }
  }

  const found = [...foundChecks].sort();
  const missingChecks = policy.ci.required_checks.filter(
    (required) => !found.some((command) => commandIncludes(command, required))
  );

  return {
    provider: workflowFiles.length > 0 ? policy.ci.provider : null,
    requiredChecks: [...policy.ci.required_checks],
    foundChecks: found,
    missingChecks
  };
}

function commandIncludes(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
