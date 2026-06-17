import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadKernelConfig } from './config.js';
import { type KernelWriteAction, writeKernelFile } from './fs.js';

export type TaskType = 'surgical-fix' | 'bugfix' | 'feature' | 'refactor' | 'migration' | 'exploration' | 'incident';

export interface CreateTaskContractOptions {
  id?: string;
  type: TaskType | string;
  goal: string;
  nonGoals?: string[];
  riskZones?: string[];
  verification?: string[];
  dryRun?: boolean;
  force?: boolean;
}

export interface CreateEvidenceLedgerOptions {
  task: string;
  claim?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface CreateHandoffPacketOptions {
  task: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface AddEvidenceCommandOptions {
  task: string;
  command: string;
  exitCode?: string;
  result?: string;
  notes?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface ShowTaskContractOptions {
  id?: string;
}

export interface TaskContractView {
  id: string;
  type: string;
  goal: string;
  relativePath: string;
  content: string;
}

export interface ArtifactFileResult {
  relativePath: string;
  path: string;
  action: KernelWriteAction;
}

export interface ArtifactWriteResult {
  taskId: string;
  files: ArtifactFileResult[];
}

export class KernelArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelArtifactError';
  }
}

export async function createTaskContract(
  rootDir: string = process.cwd(),
  options: CreateTaskContractOptions
): Promise<ArtifactWriteResult> {
  const taskId = normalizeTaskId(options.id ?? options.goal);
  const content = renderTaskContract({
    id: taskId,
    type: options.type,
    goal: options.goal,
    nonGoals: options.nonGoals,
    riskZones: options.riskZones,
    verification: options.verification
  });
  const paths = await getArtifactPaths(rootDir);
  const contractRelativePath = joinRelative(paths.contractsDir, `${taskId}.md`);
  const currentTaskRelativePath = joinRelative(paths.stateDir, 'current-task.md');

  const contract = await writeArtifact(rootDir, contractRelativePath, content, {
    dryRun: options.dryRun,
    force: options.force
  });
  const currentTask = await writeArtifact(rootDir, currentTaskRelativePath, content, {
    dryRun: options.dryRun,
    force: true
  });

  return {
    taskId,
    files: [contract, currentTask]
  };
}

export async function createEvidenceLedger(
  rootDir: string = process.cwd(),
  options: CreateEvidenceLedgerOptions
): Promise<ArtifactWriteResult> {
  const taskId = await resolveTaskId(rootDir, options.task);
  const paths = await getArtifactPaths(rootDir);
  const relativePath = joinRelative(paths.evidenceDir, `${taskId}.md`);
  const file = await writeArtifact(rootDir, relativePath, renderEvidenceLedger(taskId, options.claim), {
    dryRun: options.dryRun,
    force: options.force
  });

  return {
    taskId,
    files: [file]
  };
}

export async function createHandoffPacket(
  rootDir: string = process.cwd(),
  options: CreateHandoffPacketOptions
): Promise<ArtifactWriteResult> {
  const taskId = await resolveTaskId(rootDir, options.task);
  const paths = await getArtifactPaths(rootDir);
  const relativePath = joinRelative(paths.handoffDir, `${taskId}.md`);
  const file = await writeArtifact(rootDir, relativePath, renderHandoffPacket(taskId), {
    dryRun: options.dryRun,
    force: options.force
  });

  return {
    taskId,
    files: [file]
  };
}

export async function addEvidenceCommand(
  rootDir: string = process.cwd(),
  options: AddEvidenceCommandOptions
): Promise<ArtifactWriteResult> {
  const taskId = await resolveTaskId(rootDir, options.task);
  const paths = await getArtifactPaths(rootDir);
  const relativePath = joinRelative(paths.evidenceDir, `${taskId}.md`);
  const evidencePath = join(rootDir, relativePath);

  let existingContent: string;
  try {
    existingContent = await readFile(evidencePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new KernelArtifactError(`Evidence ledger not found at ${relativePath}. Run kernel evidence new first.`);
    }
    throw error;
  }

  const updatedContent = appendEvidenceCommandRow(existingContent, {
    command: options.command,
    exitCode: options.exitCode ?? '',
    result: options.result ?? '',
    notes: options.notes ?? ''
  });
  const file = await writeArtifact(rootDir, relativePath, updatedContent, {
    dryRun: options.dryRun,
    force: true
  });

  return {
    taskId,
    files: [file]
  };
}

export async function showTaskContract(
  rootDir: string = process.cwd(),
  options: ShowTaskContractOptions = {}
): Promise<TaskContractView> {
  const paths = await getArtifactPaths(rootDir);
  const relativePath =
    options.id === undefined
      ? joinRelative(paths.stateDir, 'current-task.md')
      : joinRelative(paths.contractsDir, `${normalizeTaskId(options.id)}.md`);
  const content = await readFile(join(rootDir, relativePath), 'utf8');
  const parsed = parseTaskContractContent(content);

  return {
    id: parsed.id,
    type: parsed.type,
    goal: parsed.goal,
    relativePath,
    content
  };
}

export interface RenderTaskContractInput {
  id: string;
  type: TaskType | string;
  goal: string;
  nonGoals?: string[];
  riskZones?: string[];
  verification?: string[];
}

export function renderTaskContract(input: RenderTaskContractInput): string {
  return [
    `# Task Contract: ${input.id}`,
    '',
    `Type: ${input.type}`,
    '',
    `Goal: ${input.goal}`,
    '',
    'Non-goals:',
    renderList(input.nonGoals),
    '',
    'Context:',
    '- To be identified during task execution.',
    '',
    'Assumptions:',
    '| Assumption | Status |',
    '|---|---|',
    '| None recorded yet. | unconfirmed |',
    '',
    'Risk zones:',
    renderList(input.riskZones),
    '',
    'Verification:',
    renderList(input.verification),
    '',
    'Done when:',
    '- Goal is satisfied.',
    '- Verification evidence is recorded.',
    '',
    'Handoff notes:',
    '- None.',
    '',
    'Open questions:',
    '- None.',
    ''
  ].join('\n');
}

export function renderEvidenceLedger(taskId: string, claim = ''): string {
  return [
    `# Evidence Ledger: ${taskId}`,
    '',
    '## Claim',
    '',
    claim,
    '',
    '## Changes inspected',
    '',
    '- None recorded yet.',
    '',
    '## Commands run',
    '',
    '| Command | Exit code | Result | Notes |',
    '|---|---:|---|---|',
    '|  |  |  |  |',
    '',
    '## Red/green evidence',
    '',
    'RED:',
    '',
    'GREEN:',
    '',
    '## Manual verification',
    '',
    '- None recorded yet.',
    '',
    '## Remaining risks',
    '',
    '- None recorded yet.',
    '',
    '## Completion status',
    '',
    'unverified / partially_verified / verified',
    ''
  ].join('\n');
}

export function renderHandoffPacket(taskId: string): string {
  return [
    `# Handoff Packet: ${taskId}`,
    '',
    '## Task',
    '',
    taskId,
    '',
    '## Current state',
    '',
    '- Not recorded yet.',
    '',
    '## Files changed',
    '',
    '- None recorded yet.',
    '',
    '## Decisions made',
    '',
    '- None recorded yet.',
    '',
    '## Commands run',
    '',
    '- None recorded yet.',
    '',
    '## Known failures',
    '',
    '- None recorded yet.',
    '',
    '## Next recommended action',
    '',
    '- Continue from the current task contract.',
    '',
    '## Do not repeat',
    '',
    '- None recorded yet.',
    '',
    '## Open questions',
    '',
    '- None.',
    ''
  ].join('\n');
}

function renderList(items: string[] | undefined): string {
  const normalized = items?.map((item) => item.trim()).filter(Boolean) ?? [];
  if (normalized.length === 0) {
    return '- None.';
  }

  return normalized.map((item) => `- ${item}`).join('\n');
}

function normalizeTaskId(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    throw new KernelArtifactError('Task id could not be derived from an empty value.');
  }

  return normalized;
}

async function resolveTaskId(rootDir: string, task: string): Promise<string> {
  if (task !== 'current') {
    return normalizeTaskId(task);
  }

  const paths = await getArtifactPaths(rootDir);
  const currentTaskPath = join(rootDir, paths.stateDir, 'current-task.md');
  const currentTask = await readFile(currentTaskPath, 'utf8');
  const match = /^# Task Contract:\s*(.+?)\s*$/m.exec(currentTask);
  if (!match?.[1]) {
    throw new KernelArtifactError(`Could not resolve current task id from ${currentTaskPath}.`);
  }

  return normalizeTaskId(match[1]);
}

async function getArtifactPaths(rootDir: string): Promise<{
  agentDir: string;
  stateDir: string;
  contractsDir: string;
  evidenceDir: string;
  handoffDir: string;
}> {
  const config = await loadKernelConfig(rootDir);
  return {
    agentDir: config.canonical.agent_dir,
    stateDir: config.canonical.state_dir,
    contractsDir: joinRelative(config.canonical.agent_dir, 'contracts'),
    evidenceDir: config.canonical.evidence_dir,
    handoffDir: config.canonical.handoff_dir
  };
}

async function writeArtifact(
  rootDir: string,
  relativePath: string,
  content: string,
  options: { dryRun?: boolean; force?: boolean }
): Promise<ArtifactFileResult> {
  const result = await writeKernelFile({
    targetPath: join(rootDir, relativePath),
    content,
    dryRun: options.dryRun,
    force: options.force,
    preserveManualSections: true
  });

  return {
    relativePath,
    path: result.targetPath,
    action: result.action
  };
}

function joinRelative(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split(/[\\/]+/))
    .filter(Boolean)
    .join('/');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function parseTaskContractContent(content: string): { id: string; type: string; goal: string } {
  const idMatch = /^# Task Contract:\s*(.+?)\s*$/m.exec(content);
  const typeMatch = /^Type:\s*(.+?)\s*$/m.exec(content);
  const goalMatch = /^Goal:\s*(.+?)\s*$/m.exec(content);

  if (!idMatch?.[1] || !typeMatch?.[1] || !goalMatch?.[1]) {
    throw new KernelArtifactError('Task contract is missing required fields (id, type, or goal).');
  }

  return {
    id: idMatch[1].trim(),
    type: typeMatch[1].trim(),
    goal: goalMatch[1].trim()
  };
}

function appendEvidenceCommandRow(
  content: string,
  row: { command: string; exitCode: string; result: string; notes: string }
): string {
  const marker = '## Commands run';
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    throw new KernelArtifactError('Evidence ledger is missing the Commands run section.');
  }

  const tableHeader = '| Command | Exit code | Result | Notes |';
  const tableHeaderIndex = content.indexOf(tableHeader, markerIndex);
  if (tableHeaderIndex === -1) {
    throw new KernelArtifactError('Evidence ledger is missing the commands table header.');
  }

  const separatorIndex = content.indexOf('|---|---:|---|---|', tableHeaderIndex);
  if (separatorIndex === -1) {
    throw new KernelArtifactError('Evidence ledger is missing the commands table separator.');
  }

  const rowLine = `| ${escapeTableCell(row.command)} | ${escapeTableCell(row.exitCode)} | ${escapeTableCell(row.result)} | ${escapeTableCell(row.notes)} |`;
  const insertIndex = content.indexOf('\n', separatorIndex) + 1;
  return `${content.slice(0, insertIndex)}${rowLine}\n${content.slice(insertIndex)}`;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}
