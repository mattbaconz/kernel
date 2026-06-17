# Changelog

All notable changes to Kernel will be documented in this file.

This project follows semantic versioning once public releases begin.

## 0.1.0 - Unreleased

### Added

- TypeScript CLI scaffold and config foundation.
- `kernel init` for `.agent/` bootstrap and safe file writing.
- Task contract, evidence ledger, and handoff packet commands.
- Deterministic repository map generation.
- Adapter compiler foundation and priority adapters for Codex, Claude Code, Cursor, Kiro, and GitHub Copilot.
- `kernel validate` with JSON output and adapter output checks.
- Canonical skill generation from the documentation vault.
- Skill linting and deterministic static eval fixtures.
- JSON output envelopes and versioned JSON Schema files.
- Schema discovery commands.
- Release-readiness integration tests and packed CLI verification.
- GitHub CI workflow.
- npm release-readiness checklist and gated manual release workflow skeleton.
- Hardened npm trusted-publishing release workflow constraints and bootstrap documentation.
- Balanced-track product improvements: lint-ready skill doc fixes, 35-skill vault generation, MVP eval fixtures.
- `kernel task show` and `kernel evidence add-command` CLI commands.
- Canonical-skill-driven adapter compiler for priority ADEs.
- Gemini CLI adapter (`kernel compile gemini`) generating `GEMINI.md` and `.gemini/settings.json`.
- Zed, OpenCode, Windsurf, and Junie tier-2 adapters.
- `kernel init --adapters` for selective adapter enablement in generated config.
- Selective `kernel map --commands/--tests/--risk` flags.
- Adapter compile deduplication for shared output paths across ADEs.
- Expanded eval fixtures for context-router, risk-map, diff-surgeon, and repo-cartographer.
- Updated CLI Command Spec for implemented commands and flags.
- Repo intelligence (0.4): v2 map schemas, CODEOWNERS, monorepo workspaces, Makefile/justfile command detection, config-aware risk maps.
- Policy engine (0.5): `policy-gate.yaml`, `kernel policy check`, verification escalation, CI policy validation.
- `kernel init` seeds `.agent/policies/policy-gate.yaml`.

### Notes

- The package remains private and unpublished.
- The package identity is `@mattbaconz/kernel`.
- The public source repository is `mattbaconz/kernel`; npm publication remains intentionally disabled.
