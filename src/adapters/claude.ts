import type { KernelAdapter } from './types.js';
import { canonicalSourceList, kernelProcedure, manualSection, primeDirective, skillFrontmatter } from './common.js';

export const claudeAdapter: KernelAdapter = {
  name: 'claude',
  render({ config, canonicalSkills }) {
    const projectName = config.project.name;
    const outputs = [
      {
        path: 'CLAUDE.md',
        content: renderClaudeMd(projectName),
        generated: true as const,
        preserveManualSections: true
      }
    ];

    if (canonicalSkills.length > 0) {
      for (const skill of canonicalSkills) {
        outputs.push({
          path: `.claude/skills/${skill.name}/SKILL.md`,
          content: skill.content,
          generated: true as const,
          preserveManualSections: true
        });
      }
      return outputs;
    }

    return [
      ...outputs,
      {
        path: '.claude/skills/kernel-core/SKILL.md',
        content: renderClaudeSkill(
          'kernel-core',
          'Use before and after non-trivial coding-agent tasks in repositories using Kernel.',
          projectName,
          'Follow Kernel task contracts, verification evidence, and handoff rules.'
        ),
        generated: true as const,
        preserveManualSections: true
      },
      {
        path: '.claude/skills/kernel-review/SKILL.md',
        content: renderClaudeSkill(
          'kernel-review',
          'Use when reviewing changes in repositories using Kernel.',
          projectName,
          'Review risk zones, evidence, generated files, and missing validation before approval.'
        ),
        generated: true as const,
        preserveManualSections: true
      },
      {
        path: '.claude/skills/kernel-debug/SKILL.md',
        content: renderClaudeSkill(
          'kernel-debug',
          'Use when debugging failures in repositories using Kernel.',
          projectName,
          'Capture reproduction steps, failing checks, and green verification in Kernel evidence.'
        ),
        generated: true as const,
        preserveManualSections: true
      },
      {
        path: '.claude/skills/kernel-handoff/SKILL.md',
        content: renderClaudeSkill(
          'kernel-handoff',
          'Use when pausing, switching agents, or preparing continuation work in repositories using Kernel.',
          projectName,
          'Write a concise handoff packet under `.agent/handoffs/` before context is lost.'
        ),
        generated: true as const,
        preserveManualSections: true
      }
    ];
  }
};

function renderClaudeMd(projectName: string): string {
  return [
    '# CLAUDE.md',
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
    ...manualSection(),
    ''
  ].join('\n');
}

function renderClaudeSkill(name: string, description: string, projectName: string, purpose: string): string {
  return [
    ...skillFrontmatter(name, description),
    '',
    `# ${name}`,
    '',
    '## Purpose',
    '',
    `${purpose} Project: ${projectName}.`,
    '',
    '## Procedure',
    '',
    ...kernelProcedure(),
    '',
    '## Output',
    '',
    'Durable Kernel artifacts under `.agent/`.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}
