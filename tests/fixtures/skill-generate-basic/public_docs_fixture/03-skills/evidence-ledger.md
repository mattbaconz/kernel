# evidence-ledger

## Purpose

Use after implementation, debugging, review, or release. Records claims and proof.

## Trigger

Use this skill when its purpose matches the current task. Do not trigger it for unrelated work just because the skill exists.

## Workflow

1. Record commands.
2. Record exit codes.
3. Record tests and screenshots.
4. Record failures before fixes when applicable.
5. Record remaining risks.

## Output

Write a concise artifact under `.agent/` when filesystem access is available. Otherwise, include the artifact in the agent response.

## Quality bar

- Be specific.
- Prefer observable facts over impressions.
- Record uncertainty explicitly.
- Avoid bloating global instruction files.
- Link output to the current task contract when applicable.
