import type { KernelAdapter } from './types.js';
import { canonicalSourceList, manualSection, primeDirective } from './common.js';

export const geminiAdapter: KernelAdapter = {
  name: 'gemini',
  render({ config, canonicalSkills }) {
    const projectName = config.project.name;
    const outputs = [
      {
        path: 'GEMINI.md',
        content: renderGeminiMd(projectName, canonicalSkills),
        generated: true as const,
        preserveManualSections: true
      },
      {
        path: '.gemini/settings.json',
        content: renderGeminiSettings(projectName, canonicalSkills),
        generated: true as const,
        preserveManualSections: false
      }
    ];

    return outputs;
  }
};

function renderGeminiMd(projectName: string, canonicalSkills: { name: string }[]): string {
  const skillList =
    canonicalSkills.length > 0
      ? canonicalSkills.map((skill) => `- \`.agent/skills/${skill.name}/SKILL.md\``).join('\n')
      : '- `.agent/skills/kernel-core/SKILL.md`';

  return [
    '# GEMINI.md',
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
    '## Canonical skills',
    '',
    skillList,
    '',
    '## Gemini workflow',
    '',
    '1. Read `GEMINI.md` and `.agent/kernel.yaml` before non-trivial implementation.',
    '2. Create or update `.agent/state/current-task.md` before implementation.',
    '3. Prefer minimal, testable changes.',
    '4. Record verification evidence before claiming completion.',
    '5. Create a handoff packet when work is incomplete or likely to move to another ADE.',
    '',
    ...manualSection(),
    ''
  ].join('\n');
}

function renderGeminiSettings(projectName: string, canonicalSkills: { name: string }[]): string {
  return `${JSON.stringify(
    {
      kernel: {
        project: projectName,
        instructionsFile: 'GEMINI.md',
        canonicalAgentDir: '.agent',
        skillsDir: '.agent/skills',
        skills: canonicalSkills.map((skill) => skill.name)
      }
    },
    null,
    2
  )}\n`;
}
