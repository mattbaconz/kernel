import type { KernelAdapter } from './types.js';
import { kernelProcedure, manualSection, primeDirective, skillFrontmatter } from './common.js';

export const githubCopilotAdapter: KernelAdapter = {
  name: 'github-copilot',
  render({ config }) {
    const projectName = config.project.name;
    return [
      {
        path: '.github/copilot-instructions.md',
        content: renderCopilotInstructions(projectName),
        generated: true,
        preserveManualSections: true
      },
      {
        path: '.github/instructions/testing.instructions.md',
        content: renderTestingInstructions(projectName),
        generated: true,
        preserveManualSections: true
      },
      {
        path: '.github/instructions/review.instructions.md',
        content: renderReviewInstructions(projectName),
        generated: true,
        preserveManualSections: true
      },
      {
        path: '.github/skills/kernel-core/SKILL.md',
        content: renderCopilotSkill(projectName),
        generated: true,
        preserveManualSections: true
      }
    ];
  }
};

function renderCopilotInstructions(projectName: string): string {
  return [
    '# GitHub Copilot Instructions',
    '',
    'This repository uses **Kernel** for repo-local agent quality artifacts.',
    '',
    `Project: ${projectName}`,
    '',
    'Before non-trivial changes, inspect `.agent/kernel.yaml` and `.agent/state/current-task.md`.',
    'Record verification in `.agent/evidence/` before claiming completion.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}

function renderTestingInstructions(projectName: string): string {
  return [
    '# Kernel Testing Instructions',
    '',
    `Use Kernel verification evidence for ${projectName}.`,
    '',
    '- Prefer targeted tests for local behavior changes.',
    '- Run project-level checks for refactors and broad changes.',
    '- Record skipped checks and remaining risks in `.agent/evidence/`.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}

function renderReviewInstructions(projectName: string): string {
  return [
    '# Kernel Review Instructions',
    '',
    `Review agent changes in ${projectName} against Kernel artifacts.`,
    '',
    `Prime directive: ${primeDirective()}`,
    '',
    '- Confirm the task contract matches the diff.',
    '- Confirm verification evidence supports completion claims.',
    '- Focus on high-risk paths, generated outputs, and missing tests.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}

function renderCopilotSkill(projectName: string): string {
  return [
    ...skillFrontmatter(
      'kernel-core',
      'Use before and after non-trivial coding-agent tasks in repositories using Kernel.'
    ),
    '',
    '# kernel-core',
    '',
    `Follow Kernel's repo-local operating protocol for ${projectName}.`,
    '',
    ...kernelProcedure(),
    '',
    ...manualSection(),
    ''
  ].join('\n');
}
