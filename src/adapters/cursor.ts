import type { KernelAdapter } from './types.js';
import { manualSection, primeDirective } from './common.js';

export const cursorAdapter: KernelAdapter = {
  name: 'cursor',
  render({ config }) {
    const projectName = config.project.name;
    return [
      {
        path: '.cursor/rules/kernel-core.mdc',
        content: renderCoreRule(projectName),
        generated: true,
        preserveManualSections: true
      },
      {
        path: '.cursor/rules/kernel-quality.mdc',
        content: renderQualityRule(projectName),
        generated: true,
        preserveManualSections: true
      },
      {
        path: '.cursor/rules/kernel-security.mdc',
        content: renderSecurityRule(projectName),
        generated: true,
        preserveManualSections: true
      }
    ];
  }
};

function renderCoreRule(projectName: string): string {
  return [
    '# Kernel Core',
    '',
    `Always use Kernel's canonical source under \`.agent/\` before non-trivial changes in ${projectName}.`,
    '',
    '- Read `.agent/kernel.yaml`.',
    '- Read or create `.agent/state/current-task.md`.',
    '- Record evidence under `.agent/evidence/` before claiming completion.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}

function renderQualityRule(projectName: string): string {
  return [
    '# Kernel Quality',
    '',
    `Use Kernel evidence and verification rules for ${projectName}.`,
    '',
    `Prime directive: ${primeDirective()}`,
    '',
    '- Prefer minimal, testable changes.',
    '- Run targeted checks that match the task risk.',
    '- Record command results and remaining risk in `.agent/evidence/`.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}

function renderSecurityRule(projectName: string): string {
  return [
    '# Kernel Security',
    '',
    `Treat high-risk paths and destructive commands cautiously in ${projectName}.`,
    '',
    '- Inspect `.agent/maps/risk.json` when present.',
    '- Do not silently perform destructive operations.',
    '- Escalate verification for auth, billing, migrations, CI, and publishing changes.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}
