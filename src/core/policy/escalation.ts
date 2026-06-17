import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { matchPathPattern } from '../repo-intelligence/glob.js';
import type { PolicyGate } from './schema.js';
import type { EscalationRequirement, VerificationLevel } from './types.js';

const VERIFICATION_RANK: Record<VerificationLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
  L5: 5
};

export interface TaskContext {
  id: string;
  type: string;
  riskZones: string[];
  evidenceCommands: string[];
  completionStatus: string;
}

export function resolveEscalation(policy: PolicyGate, task: TaskContext, paths: string[] = []): EscalationRequirement {
  const reasons: string[] = [];
  let minVerification: VerificationLevel = 'L0';
  const requiredSkills = new Set<string>();
  const requiredCommands = new Set<string>();

  const taskTypeLevel = policy.escalation.by_task_type[task.type];
  if (taskTypeLevel) {
    minVerification = maxVerification(minVerification, taskTypeLevel);
    reasons.push(`task type ${task.type} requires ${taskTypeLevel}`);
  }

  for (const zone of task.riskZones) {
    for (const rule of policy.escalation.by_path) {
      if (matchPathPattern(rule.pattern, zone)) {
        minVerification = maxVerification(minVerification, rule.min_verification);
        for (const skill of rule.required_skills) {
          requiredSkills.add(skill);
        }
        for (const command of rule.required_commands) {
          requiredCommands.add(command);
        }
        reasons.push(`risk zone ${zone} matches ${rule.pattern}`);
      }
    }
  }

  for (const path of paths) {
    for (const rule of policy.escalation.by_path) {
      if (matchPathPattern(rule.pattern, path)) {
        minVerification = maxVerification(minVerification, rule.min_verification);
        for (const skill of rule.required_skills) {
          requiredSkills.add(skill);
        }
        for (const command of rule.required_commands) {
          requiredCommands.add(command);
        }
        reasons.push(`path ${path} matches ${rule.pattern}`);
      }
    }

    for (const rule of policy.paths) {
      if (rule.min_verification && matchPathPattern(rule.pattern, path)) {
        minVerification = maxVerification(minVerification, rule.min_verification);
        for (const skill of rule.required_skills) {
          requiredSkills.add(skill);
        }
        reasons.push(`path ${path} matches policy path ${rule.pattern}`);
      }
    }
  }

  return {
    minVerification,
    requiredSkills: [...requiredSkills].sort(),
    requiredCommands: [...requiredCommands].sort(),
    reasons: reasons.sort()
  };
}

export function inferVerificationLevel(task: TaskContext): VerificationLevel {
  const commands = task.evidenceCommands.map((command) => command.toLowerCase());
  const status = task.completionStatus.toLowerCase();

  if (status.includes('specialized') || status.includes('l5')) {
    return 'L5';
  }
  if (status.includes('project checks') || status.includes('verified by project')) {
    return 'L3';
  }
  if (status.includes('targeted tests') || status.includes('partially verified')) {
    return 'L1';
  }
  if (status.includes('verified') && !status.includes('unverified')) {
    return 'L3';
  }

  const hasTypecheck = commands.some((command) => command.includes('typecheck'));
  const hasLint = commands.some((command) => command.includes('lint'));
  const hasBuild = commands.some((command) => command.includes('build'));
  const hasTest = commands.some((command) => command.includes('test'));

  if (hasTypecheck && hasLint && hasBuild && hasTest) {
    return 'L3';
  }
  if (hasTest) {
    return 'L1';
  }
  if (status.includes('unverified')) {
    return 'L0';
  }

  return 'L0';
}

export function isVerificationSufficient(actual: VerificationLevel, required: VerificationLevel): boolean {
  return VERIFICATION_RANK[actual] >= VERIFICATION_RANK[required];
}

export async function loadTaskContext(rootDir: string, task: string): Promise<TaskContext> {
  const taskId = await resolveTaskId(rootDir, task);
  const contractPath = join(rootDir, '.agent', 'state', 'current-task.md');
  const contract = await readFile(contractPath, 'utf8');
  const typeMatch = /^Type:\s*(.+?)\s*$/m.exec(contract);
  const riskSection = extractListSection(contract, 'Risk zones:');
  const evidencePath = join(rootDir, '.agent', 'evidence', `${taskId}.md`);

  let evidenceCommands: string[] = [];
  let completionStatus = 'unverified';
  try {
    const evidence = await readFile(evidencePath, 'utf8');
    evidenceCommands = parseEvidenceCommands(evidence);
    completionStatus = parseCompletionStatus(evidence);
  } catch {
    // evidence may be absent
  }

  return {
    id: taskId,
    type: typeMatch?.[1]?.trim() ?? 'feature',
    riskZones: riskSection,
    evidenceCommands,
    completionStatus
  };
}

async function resolveTaskId(rootDir: string, task: string): Promise<string> {
  if (task !== 'current') {
    return normalizeTaskId(task);
  }

  const contractPath = join(rootDir, '.agent', 'state', 'current-task.md');
  const contract = await readFile(contractPath, 'utf8');
  const match = /^# Task Contract:\s*(.+?)\s*$/m.exec(contract);
  if (!match?.[1]) {
    throw new Error(`Could not resolve current task id from ${contractPath}.`);
  }
  return normalizeTaskId(match[1]);
}

function normalizeTaskId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractListSection(content: string, heading: string): string[] {
  const headingIndex = content.indexOf(heading);
  if (headingIndex === -1) {
    return [];
  }

  const afterHeading = content.slice(headingIndex + heading.length);
  const nextHeadingIndex = afterHeading.search(/\n[A-Za-z][^\n]*:\n/);
  const section = nextHeadingIndex === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIndex);
  return section
    .split('\n')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter((line) => line && line !== 'None.');
}

function parseEvidenceCommands(content: string): string[] {
  const marker = '## Commands run';
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    return [];
  }

  const lines = content.slice(markerIndex).split('\n');
  const commands: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('Command | Exit code')) {
      continue;
    }
    if (line.includes('---')) {
      continue;
    }
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    if (cells[0]) {
      commands.push(cells[0]);
    }
  }
  return commands;
}

function parseCompletionStatus(content: string): string {
  const marker = '## Completion status';
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    return 'unverified';
  }
  const after = content.slice(markerIndex + marker.length).trim();
  const line = after.split('\n').find((entry) => entry.trim().length > 0);
  return line?.trim() ?? 'unverified';
}

function maxVerification(left: VerificationLevel, right: VerificationLevel): VerificationLevel {
  return VERIFICATION_RANK[left] >= VERIFICATION_RANK[right] ? left : right;
}

export async function extractWorkflowRunCommands(workflowPath: string): Promise<string[]> {
  const content = await readFile(workflowPath, 'utf8');
  const parsed = parseYaml(content) as unknown;
  const commands = new Set<string>();
  collectRunCommands(parsed, commands);
  return [...commands].sort();
}

function collectRunCommands(value: unknown, commands: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectRunCommands(entry, commands);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'run' && typeof child === 'string') {
      for (const line of child.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) {
          commands.add(trimmed);
        }
      }
    } else {
      collectRunCommands(child, commands);
    }
  }
}
