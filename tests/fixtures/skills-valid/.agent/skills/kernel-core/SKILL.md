---
name: kernel-core
description: Use when coordinating non-trivial coding-agent tasks. Do not use for trivial one-line edits unless the touched area is high-risk.
---

# kernel-core

## Purpose

Coordinate task contracts, verification, evidence, and handoff discipline for non-trivial agent work.

## Trigger

Use when a coding-agent task requires durable context, quality gates, or evidence-backed completion.

## Workflow

1. Read the current task contract.
2. Select relevant quality gates.
3. Record evidence before completion.

## Output

Writes or updates `.agent/state/current-task.md` and `.agent/evidence/` artifacts when filesystem access is available.
