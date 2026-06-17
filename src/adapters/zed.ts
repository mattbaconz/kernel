import { findCanonicalSkill, resolveCursorRuleContent } from './canonical-skills.js';
import type { KernelAdapter } from './types.js';
import { manualSection } from './common.js';

export const zedAdapter: KernelAdapter = {
  name: 'zed',
  render({ config, canonicalSkills }) {
    const projectName = config.project.name;
    return [
      {
        path: '.rules',
        content: resolveCursorRuleContent(
          canonicalSkills,
          'kernel-core',
          renderZedRulesFallback(projectName),
          manualSection()
        ),
        generated: true,
        preserveManualSections: true
      }
    ];
  }
};

function renderZedRulesFallback(projectName: string): string {
  return [
    '# Kernel',
    '',
    `Use Kernel's canonical source under \`.agent/\` before non-trivial changes in ${projectName}.`,
    '',
    '- Read `.agent/kernel.yaml`.',
    '- Read or create `.agent/state/current-task.md`.',
    '- Record evidence under `.agent/evidence/` before claiming completion.'
  ].join('\n');
}

export function renderSkillMarkdownContent(
  canonicalSkills: Parameters<KernelAdapter['render']>[0]['canonicalSkills'],
  skillName: string,
  fallback: string
): string {
  const skill = findCanonicalSkill(canonicalSkills, skillName);
  return skill?.content ?? fallback;
}
