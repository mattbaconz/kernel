# kernel-core

## Purpose

Use before and after any non-trivial coding-agent task. Creates or updates a task contract, identifies relevant context, selects quality gates, requires evidence before completion, and writes a handoff packet when needed. Do not use for trivial one-line edits unless the touched area is high-risk.

## Trigger

Use this skill when its purpose matches the current task. Do not trigger it for unrelated work just because the skill exists.

## Workflow

1. Read or create `.agent/state/current-task.md`.
2. Classify task type and risk.
3. Route to relevant subskills.
4. Require evidence before completion.
5. Create handoff if context is long or work is incomplete.

## Output

Write a concise artifact under `.agent/` when filesystem access is available. Otherwise, include the artifact in the agent response.

## Quality bar

- Be specific.
- Prefer observable facts over impressions.
- Record uncertainty explicitly.
- Avoid bloating global instruction files.
- Link output to the current task contract when applicable.
