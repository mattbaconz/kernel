export type PolicyClass = 'safe' | 'review' | 'block';

export type VerificationLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export interface PolicyViolation {
  code:
    | 'policy_command_blocked'
    | 'policy_command_review'
    | 'policy_path_review'
    | 'policy_path_block'
    | 'insufficient_verification_level'
    | 'missing_ci_check'
    | 'missing_policy_file';
  severity: 'error' | 'warning';
  path: string;
  message: string;
  policyClass: PolicyClass;
}

export interface PolicyCheckResult {
  status: 'pass' | 'warn' | 'fail';
  strict: boolean;
  blockCount: number;
  reviewCount: number;
  warningCount: number;
  violations: PolicyViolation[];
}

export interface ClassifiedCommand {
  command: string;
  policyClass: PolicyClass;
  reason: string;
  source: string;
}

export interface ClassifiedPath {
  path: string;
  policyClass: PolicyClass;
  reason: string;
  minVerification?: VerificationLevel;
  requiredSkills?: string[];
}

export interface EscalationRequirement {
  minVerification: VerificationLevel;
  requiredSkills: string[];
  requiredCommands: string[];
  reasons: string[];
}

export interface CiCheckResult {
  provider: string | null;
  requiredChecks: string[];
  foundChecks: string[];
  missingChecks: string[];
}
