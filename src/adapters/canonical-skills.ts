import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { KernelConfig } from '../core/config.js';

export interface CanonicalSkill {
  name: string;
  relativePath: string;
  content: string;
}

export async function loadCanonicalSkills(rootDir: string, config: KernelConfig): Promise<CanonicalSkill[]> {
  const skillsRoot = join(rootDir, config.canonical.skills_dir);

  if (!(await pathExists(skillsRoot))) {
    return [];
  }

  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skills: CanonicalSkill[] = [];

  for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const skillPath = join(skillsRoot, entry.name, 'SKILL.md');
    if (!(await pathExists(skillPath))) {
      continue;
    }

    const content = await readFile(skillPath, 'utf8');
    skills.push({
      name: entry.name,
      relativePath: join(config.canonical.skills_dir, entry.name, 'SKILL.md').replace(/\\/g, '/'),
      content
    });
  }

  return skills;
}

export function findCanonicalSkill(skills: CanonicalSkill[], name: string): CanonicalSkill | undefined {
  return skills.find((skill) => skill.name === name);
}

export function skillBodyWithoutFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/u.exec(content);
  return match ? content.slice(match[0].length).trimStart() : content;
}

export function renderCursorRuleFromSkill(skillName: string, content: string): string {
  const body = skillBodyWithoutFrontmatter(content);
  const title = body.match(/^#\s+(.+)$/m)?.[1] ?? skillName;
  return [`# ${title}`, '', body.replace(/^#\s+.+\n?/m, '').trim()].join('\n');
}

export function resolveCursorRuleContent(
  skills: CanonicalSkill[],
  skillName: string,
  fallback: string,
  manualSectionLines: string[]
): string {
  const skill = findCanonicalSkill(skills, skillName);
  const core = skill ? renderCursorRuleFromSkill(skill.name, skill.content) : fallback;
  return [...core.split('\n'), '', ...manualSectionLines, ''].join('\n');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
