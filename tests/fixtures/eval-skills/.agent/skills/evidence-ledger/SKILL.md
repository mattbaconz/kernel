---
name: evidence-ledger
description: Use after implementation, debugging, review, or release work to record claims and proof. Do not use when no claim or verification artifact is needed.
---

# evidence-ledger

## Purpose

Record claims, commands, verification results, artifacts, and remaining risk for a task.

## Trigger

Use after a task has verification evidence that should be preserved for review or handoff.

## Workflow

1. Identify the task claim.
2. Record commands and results.
3. Record remaining risks.

## Output

Writes `.agent/evidence/<task-id>.md` when filesystem access is available.
