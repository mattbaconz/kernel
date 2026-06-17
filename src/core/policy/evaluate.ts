import { matchPathPattern } from '../repo-intelligence/glob.js';
import type { PolicyGate } from './schema.js';
import type { ClassifiedCommand, ClassifiedPath, PolicyClass } from './types.js';

export function classifyCommand(command: string, policy: PolicyGate): ClassifiedCommand {
  const haystack = command.toLowerCase();
  let best: ClassifiedCommand = {
    command,
    policyClass: 'safe',
    reason: 'no matching policy rule',
    source: 'default'
  };

  for (const rule of policy.commands) {
    if (!haystack.includes(rule.match.toLowerCase())) {
      continue;
    }
    const policyClass = rule.class;
    if (comparePolicyClass(policyClass, best.policyClass) > 0) {
      best = {
        command,
        policyClass,
        reason: rule.reason ?? `matches policy rule: ${rule.match}`,
        source: 'policy-gate.yaml'
      };
    }
  }

  return best;
}

export function classifyPath(path: string, policy: PolicyGate): ClassifiedPath {
  let best: ClassifiedPath = {
    path,
    policyClass: 'safe',
    reason: 'no matching policy rule'
  };

  for (const rule of policy.paths) {
    if (!matchPathPattern(rule.pattern, path)) {
      continue;
    }
    if (comparePolicyClass(rule.class, best.policyClass) >= 0) {
      best = {
        path,
        policyClass: rule.class,
        reason: rule.reason ?? `matches policy pattern: ${rule.pattern}`,
        minVerification: rule.min_verification,
        requiredSkills: rule.required_skills
      };
    }
  }

  return best;
}

export function scanRepoCommands(
  scripts: Array<{ name: string; command: string; script: string }>,
  policy: PolicyGate
): ClassifiedCommand[] {
  const results: ClassifiedCommand[] = [];
  for (const script of scripts) {
    const classified = classifyCommand(`${script.command} ${script.script}`, policy);
    if (classified.policyClass !== 'safe') {
      results.push({
        ...classified,
        command: script.command,
        reason: `${classified.reason} (script: ${script.name})`
      });
    }
  }
  return results.sort((left, right) => left.command.localeCompare(right.command, 'en'));
}

export function scanRepoPaths(paths: string[], policy: PolicyGate): ClassifiedPath[] {
  const results: ClassifiedPath[] = [];
  for (const path of paths) {
    const classified = classifyPath(path, policy);
    if (classified.policyClass !== 'safe') {
      results.push(classified);
    }
  }
  return results.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

function comparePolicyClass(left: PolicyClass, right: PolicyClass): number {
  const rank: Record<PolicyClass, number> = { safe: 0, review: 1, block: 2 };
  return rank[left] - rank[right];
}
