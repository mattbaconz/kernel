# debug-probe

## Purpose

Use when investigating a concrete bug, failing test, or unclear runtime behavior.

## Trigger

Use this skill when its purpose matches the current task. Do not trigger it for unrelated work just because the skill exists.

## Workflow

1. Capture the observed failure.
2. Form one concrete hypothesis.
3. Add the smallest useful probe.
4. Record the result before changing implementation.

## Output

Write a concise artifact under `.agent/evidence/` when filesystem access is available. Otherwise, include the artifact in the agent response.

## Quality bar

- Prefer observable facts over impressions.
- Keep probes scoped and reversible.
- Record uncertainty explicitly.
