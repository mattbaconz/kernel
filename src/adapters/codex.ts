import type { KernelAdapter } from './types.js';
import { canonicalSourceList, manualSection, primeDirective } from './common.js';

export const codexAdapter: KernelAdapter = {
  name: 'codex',
  render({ config, canonicalSkills }) {
    const projectName = config.project.name;
    const outputs = [
      {
        path: 'AGENTS.md',
        content: renderCodexAgents(projectName),
        generated: true as const,
        preserveManualSections: true
      }
    ];

    for (const skill of canonicalSkills) {
      outputs.push({
        path: `.agents/skills/${skill.name}/SKILL.md`,
        content: skill.content,
        generated: true as const,
        preserveManualSections: true
      });
    }

    if (canonicalSkills.length === 0) {
      outputs.push({
        path: '.agents/skills/kernel-core/SKILL.md',
        content: renderFallbackKernelCoreSkill(projectName),
        generated: true as const,
        preserveManualSections: true
      });
    }

    return outputs;
  }
};

function renderCodexAgents(projectName: string): string {
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
    '## Codex workflow',
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

function renderFallbackKernelCoreSkill(projectName: string): string {
  return [
    '---',
    'name: kernel-core',
    'description: Use before and after non-trivial coding-agent tasks in repositories using Kernel. Creates or updates task contracts, identifies context and risk, requires evidence before completion, and creates handoff packets when needed. Do not use for trivial one-line edits unless the touched area is high-risk.',
    '---',
    '',
    '# kernel-core',
    '',
    '## Purpose',
    '',
    `Use this Codex skill to follow Kernel's repo-local operating protocol for ${projectName}.`,
    '',
    '## Procedure',
    '',
    '1. Read `AGENTS.md` and `.agent/kernel.yaml`.',
    '2. Read or create `.agent/state/current-task.md`.',
    '3. Define goal, non-goals, assumptions, risk zones, verification, and done criteria.',
    '4. Make minimal, testable changes.',
    '5. Record evidence in `.agent/evidence/` before claiming completion.',
    '6. Create a handoff packet in `.agent/handoffs/` when work is incomplete or long-running.',
    '',
    '## Output',
    '',
    'Durable Kernel artifacts under `.agent/`.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}
