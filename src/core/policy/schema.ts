import { z } from 'zod';

const policyClassSchema = z.enum(['safe', 'review', 'block']);
const verificationLevelSchema = z.enum(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);

export const policyCommandRuleSchema = z.object({
  class: policyClassSchema,
  match: z.string().min(1),
  reason: z.string().optional()
});

export const policyPathRuleSchema = z.object({
  pattern: z.string().min(1),
  class: policyClassSchema.default('review'),
  reason: z.string().optional(),
  min_verification: verificationLevelSchema.optional(),
  required_skills: z.array(z.string()).default([])
});

export const policyEscalationPathRuleSchema = z.object({
  pattern: z.string().min(1),
  min_verification: verificationLevelSchema,
  required_skills: z.array(z.string()).default([]),
  required_commands: z.array(z.string()).default([])
});

export const policyGateSchema = z
  .object({
    version: z.literal(1),
    commands: z.array(policyCommandRuleSchema).default([]),
    paths: z.array(policyPathRuleSchema).default([]),
    escalation: z
      .object({
        by_task_type: z.record(z.string(), verificationLevelSchema).default({}),
        by_path: z.array(policyEscalationPathRuleSchema).default([])
      })
      .default({ by_task_type: {}, by_path: [] }),
    ci: z
      .object({
        provider: z.enum(['github-actions']).default('github-actions'),
        required_checks: z.array(z.string()).default([])
      })
      .default({ provider: 'github-actions', required_checks: [] })
  })
  .strict();

export type PolicyGate = z.infer<typeof policyGateSchema>;
export type PolicyCommandRule = z.infer<typeof policyCommandRuleSchema>;
export type PolicyPathRule = z.infer<typeof policyPathRuleSchema>;
