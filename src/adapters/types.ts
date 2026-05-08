import type { KernelConfig } from '../core/config.js';

export interface AdapterRenderContext {
  config: KernelConfig;
}

export interface AdapterOutput {
  path: string;
  content: string;
  generated: true;
  preserveManualSections: boolean;
}

export interface KernelAdapter {
  name: string;
  render(context: AdapterRenderContext): AdapterOutput[];
}
