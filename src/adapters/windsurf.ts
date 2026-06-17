import { resolveCursorRuleContent } from './canonical-skills.js';
import type { KernelAdapter } from './types.js';
import { manualSection } from './common.js';
import { renderSkillMarkdownContent } from './zed.js';

export const windsurfAdapter: KernelAdapter = {
  name: 'windsurf',
  render({ config, canonicalSkills }) {
    const projectName = config.project.name;
    return [
      {
        path: '.windsurf/rules/kernel-core.md',
        content: resolveCursorRuleContent(
          canonicalSkills,
          'kernel-core',
          renderWindsurfCoreFallback(projectName),
          manualSection()
        ),
        generated: true,
        preserveManualSections: true
      },
      {
        path: '.windsurf/workflows/kernel-review.md',
        content: renderSkillMarkdownContent(
          canonicalSkills,
          'verify-lattice',
          renderWindsurfReviewFallback(projectName)
        ),
        generated: true,
        preserveManualSections: true
      }
    ];
  }
};

function renderWindsurfCoreFallback(projectName: string): string {
  return [
    '# Kernel Core',
    '',
    `Use Kernel canonical artifacts in ${projectName} before non-trivial implementation.`,
    '',
    '- Read `.agent/kernel.yaml` and `.agent/state/current-task.md`.',
    '- Record evidence in `.agent/evidence/` before claiming completion.'
  ].join('\n');
}

function renderWindsurfReviewFallback(projectName: string): string {
  return [
    '# Kernel Review',
    '',
    `Select verification level and record evidence for ${projectName} before completion.`,
    '',
    '- Match verification to task risk.',
    '- Record command results in `.agent/evidence/`.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}
