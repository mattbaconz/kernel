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

export function skillFrontmatter(name: string, description: string): string[] {
  return ['---', `name: ${name}`, `description: ${description}`, '---'];
}
