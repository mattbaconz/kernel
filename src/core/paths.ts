import { resolve } from 'node:path';

import type { KernelConfig } from './config.js';

export interface CanonicalPaths {
  agentDir: string;
  skillsDir: string;
  stateDir: string;
  evidenceDir: string;
  handoffDir: string;
  mapsDir: string;
  configFile: string;
}

export function resolveCanonicalPaths(rootDir: string, config: KernelConfig): CanonicalPaths {
  return {
    agentDir: resolve(rootDir, config.canonical.agent_dir),
    skillsDir: resolve(rootDir, config.canonical.skills_dir),
    stateDir: resolve(rootDir, config.canonical.state_dir),
    evidenceDir: resolve(rootDir, config.canonical.evidence_dir),
    handoffDir: resolve(rootDir, config.canonical.handoff_dir),
    mapsDir: resolve(rootDir, config.canonical.maps_dir),
    configFile: resolve(rootDir, config.canonical.agent_dir, 'kernel.yaml')
  };
}
