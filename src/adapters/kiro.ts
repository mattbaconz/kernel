import type { KernelAdapter } from './types.js';
import { canonicalSourceList, manualSection, primeDirective } from './common.js';

export const kiroAdapter: KernelAdapter = {
  name: 'kiro',
  render({ config }) {
    const projectName = config.project.name;
    return [
      {
        path: '.kiro/steering/kernel.md',
        content: renderKernelSteering(projectName),
        generated: true,
        preserveManualSections: true
      },
      {
        path: '.kiro/steering/verification.md',
        content: renderVerificationSteering(projectName),
        generated: true,
        preserveManualSections: true
      },
      {
        path: '.kiro/hooks/kernel-evidence.json',
        content: renderEvidenceHook(projectName),
        generated: true,
        preserveManualSections: false
      },
      {
        path: '.kiro/specs/kernel/requirements.md',
        content: renderKernelRequirements(projectName),
        generated: true,
        preserveManualSections: true
      }
    ];
  }
};

function renderKernelSteering(projectName: string): string {
  return [
    '# Kernel Steering',
    '',
    `Project: ${projectName}`,
    '',
    `Prime directive: ${primeDirective()}`,
    '',
    'Use Kernel canonical artifacts before non-trivial implementation:',
    '',
    ...canonicalSourceList(),
    '',
    ...manualSection(),
    ''
  ].join('\n');
}

function renderVerificationSteering(projectName: string): string {
  return [
    '# Kernel Verification',
    '',
    `Use Kernel verification evidence for ${projectName}.`,
    '',
    '- Select checks based on task risk.',
    '- Record command output in `.agent/evidence/`.',
    '- Do not claim completion beyond recorded evidence.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}

function renderEvidenceHook(projectName: string): string {
  return `${JSON.stringify(
    {
      name: 'kernel-evidence',
      description: 'Require Kernel evidence before completion claims.',
      project: projectName,
      canonicalEvidencePath: '.agent/evidence/',
      canonicalTaskPath: '.agent/state/current-task.md'
    },
    null,
    2
  )}\n`;
}

function renderKernelRequirements(projectName: string): string {
  return [
    '# Kernel Requirements',
    '',
    `Kernel-generated Kiro specs for ${projectName} must defer to canonical task contracts under \`.agent/contracts/\`.`,
    '',
    '- Keep generated specs thin.',
    '- Link to current task state in `.agent/state/current-task.md`.',
    '- Preserve verification evidence in `.agent/evidence/`.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}
