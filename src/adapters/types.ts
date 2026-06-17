import type { KernelConfig } from '../core/config.js';
import type { CanonicalSkill } from './canonical-skills.js';

export interface AdapterRenderContext {
  config: KernelConfig;
  canonicalSkills: CanonicalSkill[];
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
