# verify-lattice

## Purpose

Use before declaring completion. Selects and records the appropriate verification level for the task.

## Trigger

Use this skill when its purpose matches the current task. Do not trigger it for unrelated work just because the skill exists.

## Workflow

1. Choose L0-L5 verification.
2. Run or request commands.
3. Record outputs.
4. Mark completion status.
5. List remaining risk.

## Output

Write a concise artifact under `.agent/` when filesystem access is available. Otherwise, include the artifact in the agent response.

## Quality bar

- Be specific.
- Prefer observable facts over impressions.
- Record uncertainty explicitly.
- Avoid bloating global instruction files.
- Link output to the current task contract when applicable.
