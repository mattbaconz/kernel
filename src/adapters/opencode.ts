import type { KernelAdapter } from './types.js';
import { manualSection, skillFrontmatter } from './common.js';

export const opencodeAdapter: KernelAdapter = {
  name: 'opencode',
  render({ config, canonicalSkills }) {
    const projectName = config.project.name;
    const skills = canonicalSkills.length > 0 ? canonicalSkills : [fallbackKernelCoreSkill(projectName)];
    const outputs = [];

    for (const skill of skills) {
      outputs.push({
        path: `.opencode/skills/${skill.name}/SKILL.md`,
        content: skill.content,
        generated: true as const,
        preserveManualSections: true
      });
      outputs.push({
        path: `.agents/skills/${skill.name}/SKILL.md`,
        content: skill.content,
        generated: true as const,
        preserveManualSections: true
      });
    }

    return outputs;
  }
};

function fallbackKernelCoreSkill(projectName: string) {
  return {
    name: 'kernel-core',
    content: [
      ...skillFrontmatter(
        'kernel-core',
        'Use before and after non-trivial coding-agent tasks in repositories using Kernel.'
      ),
      '',
      '# kernel-core',
      '',
      `Follow Kernel's repo-local operating protocol for ${projectName}.`,
      '',
      ...manualSection(),
      ''
    ].join('\n')
  };
}
