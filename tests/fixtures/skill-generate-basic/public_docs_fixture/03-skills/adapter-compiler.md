# adapter-compiler

## Purpose

Use when generating ADE-specific files from canonical Kernel source.

## Trigger

Use this skill when its purpose matches the current task. Do not trigger it for unrelated work just because the skill exists.

## Workflow

1. Read `.agent/kernel.yaml`.
2. Generate adapter outputs.
3. Preserve manual sections.
4. Validate freshness.

## Output

Write a concise artifact under `.agent/` when filesystem access is available. Otherwise, include the artifact in the agent response.

## Quality bar

- Be specific.
- Prefer observable facts over impressions.
- Record uncertainty explicitly.
- Avoid bloating global instruction files.
- Link output to the current task contract when applicable.
