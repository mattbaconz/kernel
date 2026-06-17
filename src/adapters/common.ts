export function primeDirective(): string {
  return 'No contract, no implementation. No evidence, no completion. No handoff, no continuity.';
}

export function manualSection(): string[] {
  return ['<!-- kernel:manual:start -->', '', '<!-- kernel:manual:end -->'];
}

export function canonicalSourceList(): string[] {
  return [
    '- Kernel config: `.agent/kernel.yaml`',
    '- Current task: `.agent/state/current-task.md`',
    '- Task contracts: `.agent/contracts/`',
    '- Evidence ledgers: `.agent/evidence/`',
    '- Handoff packets: `.agent/handoffs/`',
    '- Repository maps: `.agent/maps/`'
  ];
}

export function kernelProcedure(): string[] {
  return [
    '1. Read repository instructions and `.agent/kernel.yaml`.',
    '2. Read or create `.agent/state/current-task.md`.',
    '3. Define goal, non-goals, assumptions, risk zones, verification, and done criteria.',
    '4. Make minimal, testable changes.',
    '5. Record evidence in `.agent/evidence/` before claiming completion.',
    '6. Create a handoff packet in `.agent/handoffs/` when work is incomplete or long-running.'
  ];
}

export function renderKernelBootstrapAgents(projectName: string, workflowLabel: string): string {
  return [
    '# AGENTS.md',
    '',
    'This repository uses **Kernel** for repo-local task contracts, verification evidence, and agent handoffs.',
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
    `## ${workflowLabel}`,
    '',
    '1. Read `AGENTS.md` and `.agent/kernel.yaml` before non-trivial implementation.',
    '2. Create or update `.agent/state/current-task.md` before implementation.',
    '3. Prefer minimal, testable changes.',
    '4. Record verification evidence before claiming completion.',
    '5. Create a handoff packet when work is incomplete or likely to move to another ADE.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}

export function skillFrontmatter(name: string, description: string): string[] {
  return ['---', `name: ${name}`, `description: ${description}`, '---'];
}
