# task-contract

## Purpose

Use before non-trivial coding, debugging, refactoring, migration, or review work. Converts vague requests into compact goals, non-goals, assumptions, risks, verification, and done criteria.

## Trigger

Use this skill when its purpose matches the current task. Do not trigger it for unrelated work just because the skill exists.

## Workflow

1. Define task type.
2. Write observable goal.
3. Write non-goals.
4. List assumptions as confirmed or unconfirmed.
5. Define verification and done criteria.

## Output

Write a concise artifact under `.agent/` when filesystem access is available. Otherwise, include the artifact in the agent response.

## Quality bar

- Be specific.
- Prefer observable facts over impressions.
- Record uncertainty explicitly.
- Avoid bloating global instruction files.
- Link output to the current task contract when applicable.
