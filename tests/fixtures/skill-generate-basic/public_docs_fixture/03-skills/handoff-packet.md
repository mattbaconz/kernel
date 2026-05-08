# handoff-packet

## Purpose

Use when switching ADEs, ending a long session, pausing incomplete work, or before another agent continues.

## Trigger

Use this skill when its purpose matches the current task. Do not trigger it for unrelated work just because the skill exists.

## Workflow

1. Summarize task.
2. List changed files.
3. List commands run.
4. List known failures.
5. List next actions and do-not-repeat notes.

## Output

Write a concise artifact under `.agent/` when filesystem access is available. Otherwise, include the artifact in the agent response.

## Quality bar

- Be specific.
- Prefer observable facts over impressions.
- Record uncertainty explicitly.
- Avoid bloating global instruction files.
- Link output to the current task contract when applicable.
