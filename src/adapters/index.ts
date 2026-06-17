import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { cursorAdapter } from './cursor.js';
import { geminiAdapter } from './gemini.js';
import { githubCopilotAdapter } from './github-copilot.js';
import { junieAdapter } from './junie.js';
import { kiroAdapter } from './kiro.js';
import { opencodeAdapter } from './opencode.js';
import { windsurfAdapter } from './windsurf.js';
import { zedAdapter } from './zed.js';
import type { KernelAdapter } from './types.js';

const ADAPTERS = {
  codex: codexAdapter,
  claude: claudeAdapter,
  cursor: cursorAdapter,
  kiro: kiroAdapter,
  'github-copilot': githubCopilotAdapter,
  gemini: geminiAdapter,
  zed: zedAdapter,
  opencode: opencodeAdapter,
  windsurf: windsurfAdapter,
  junie: junieAdapter
} as const satisfies Record<string, KernelAdapter>;

const ALL_ADAPTER_ORDER = [
  'codex',
  'claude',
  'cursor',
  'kiro',
  'github-copilot',
  'gemini',
  'zed',
  'opencode',
  'windsurf',
  'junie'
] as const;

export const ADAPTER_TARGET_NAMES = Object.keys(ADAPTERS) as AdapterTarget[];

export class KernelAdapterTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelAdapterTargetError';
  }
}

export function parseAdapterTargetList(value: string): AdapterTarget[] {
  const targets = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (targets.length === 0) {
    throw new KernelAdapterTargetError('Adapter list must include at least one adapter target.');
  }

  const unknown = targets.filter((target) => !(target in ADAPTERS));
  if (unknown.length > 0) {
    throw new KernelAdapterTargetError(
      `Unknown adapter target(s): ${unknown.join(', ')}. Available targets: ${ADAPTER_TARGET_NAMES.join(', ')}.`
    );
  }

  return targets as AdapterTarget[];
}

export function adapterTargetToConfigKey(target: AdapterTarget): keyof import('../core/config.js').KernelConfig['adapters'] {
  if (target === 'github-copilot') {
    return 'github_copilot';
  }

  return target;
}

export type AdapterTarget = keyof typeof ADAPTERS;
export type CompileTarget = AdapterTarget | 'all';

export function getAdapter(target: string): KernelAdapter {
  const adapter = ADAPTERS[target as AdapterTarget];
  if (!adapter) {
    throw new Error(`Unsupported adapter target: ${target}`);
  }

  return adapter;
}

export function getAdaptersForTarget(target: string): KernelAdapter[] {
  if (target === 'all') {
    return ALL_ADAPTER_ORDER.map((adapterTarget) => ADAPTERS[adapterTarget]);
  }

  return [getAdapter(target)];
}
