# Contributing

Kernel is currently pre-release and private. Contributions should be small, evidence-backed, and aligned with the repository's Kernel workflow.

## Development Setup

```bash
pnpm install
pnpm build
```

## Before Changing Code

For non-trivial work:

1. Read `AGENTS.md`.
2. Read `.agent/state/current-task.md`.
3. Update the task contract or create a new one.
4. Define goal, non-goals, assumptions, risk zones, verification, and done criteria.
5. Keep changes minimal and testable.

## Required Checks

Run these before opening a pull request:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm verify:packed
```

If a check cannot be run, document why in `.agent/evidence/`.

## Pull Request Expectations

A pull request should include:

- task contract reference
- summary of changed behavior
- tests or fixtures added
- verification commands and results
- remaining risks

Avoid unrelated formatting churn and broad rewrites. Do not manually edit generated adapter outputs unless the task is specifically about generation behavior.

## Release Posture

The package remains private and unpublished. Do not remove `private: true`, publish to npm, or change repository visibility without an explicit release task.
