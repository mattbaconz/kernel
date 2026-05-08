import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { cursorAdapter } from './cursor.js';
import { githubCopilotAdapter } from './github-copilot.js';
import { kiroAdapter } from './kiro.js';
import type { KernelAdapter } from './types.js';

const ADAPTERS = {
  codex: codexAdapter,
  claude: claudeAdapter,
  cursor: cursorAdapter,
  kiro: kiroAdapter,
  'github-copilot': githubCopilotAdapter
} as const satisfies Record<string, KernelAdapter>;

const ALL_ADAPTER_ORDER = ['codex', 'claude', 'cursor', 'kiro', 'github-copilot'] as const;

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
