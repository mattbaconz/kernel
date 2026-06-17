import type { KernelAdapter } from './types.js';
import { canonicalSourceList, manualSection, primeDirective } from './common.js';

export const junieAdapter: KernelAdapter = {
  name: 'junie',
  render({ config }) {
    const projectName = config.project.name;
    return [
      {
        path: '.junie/AGENTS.md',
        content: renderJunieAgents(projectName),
        generated: true,
        preserveManualSections: true
      }
    ];
  }
};

function renderJunieAgents(projectName: string): string {
  return [
    '# AGENTS.md',
    '',
    'This repository uses **Kernel** for repo-local task contracts, verification evidence, and handoffs.',
    '',
    `Project: ${projectName}`,
    '',
    '## Prime directive',
    '',
    primeDirective(),
    '',
    '## Canonical source',
    '',
    ...canonicalSourceList(),
    '',
    '## Junie workflow',
    '',
    '1. Read `.junie/AGENTS.md` and `.agent/kernel.yaml` before non-trivial implementation.',
    '2. Create or update `.agent/state/current-task.md` before implementation.',
    '3. Prefer minimal, testable changes.',
    '4. Record verification evidence before claiming completion.',
    '5. Create a handoff packet when work is incomplete or likely to move to another ADE.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}
