# Kernel

Kernel is a repo-local quality system and portable operating layer for coding agents.

It helps Codex, Claude Code, Cursor, Kiro, GitHub Copilot, Gemini CLI, Windsurf, OpenCode, Junie, Zed, and future ADEs work from the same durable task contracts, repo maps, verification evidence, policies, handoff packets, canonical skills, and generated adapter files.

## Status

Kernel is pre-release software. The source repository is public, and the package identity is `@mattbaconz/kernel`. The package is still private and unpublished until an explicit public release task.

## What Kernel Provides

- `kernel init` for `.agent/` bootstrap
- task contracts under `.agent/state/` and `.agent/contracts/`
- evidence ledgers under `.agent/evidence/`
- handoff packets under `.agent/handoffs/`
- deterministic repo maps under `.agent/maps/`
- canonical skill generation under `.agent/skills/`
- adapter compilation for Codex, Claude Code, Cursor, Kiro, and GitHub Copilot
- validation, skill linting, static skill eval fixtures, and JSON schema discovery

## Development Install

Use Node.js 20 or newer and pnpm 10.24.0.

```bash
pnpm install
pnpm build
```

Run the CLI from source after building:

```bash
node dist/cli/index.js --help
```

## Local Packed Install

For release-artifact testing without publishing:

```bash
pnpm build
npm pack
npm install -g ./mattbaconz-kernel-0.1.0.tgz
kernel --help
```

Once published, the intended package install name is:

```bash
npm install -g @mattbaconz/kernel
```

The project also includes an automated packed-artifact check:

```bash
pnpm verify:packed
```

## Quickstart In A Repository

Initialize Kernel:

```bash
kernel init
kernel skill generate --set lint-ready
kernel map
kernel compile all
kernel validate
```

Create work artifacts:

```bash
kernel task new --type feature --goal "Describe the change"
kernel evidence new --task current --claim "Describe what was verified"
kernel handoff new --task current
```

Run quality checks:

```bash
kernel validate --json
kernel skill lint --json
kernel eval --json
kernel schema versions
kernel schema list
kernel schema path skill-eval-result
kernel schema show skill-eval-result --json
```

## Adapter Compilation

Compile every priority ADE adapter:

```bash
kernel compile all
```

Compile one adapter:

```bash
kernel compile codex
kernel compile claude
kernel compile cursor
kernel compile kiro
kernel compile github-copilot
kernel compile gemini
kernel compile zed
kernel compile opencode
kernel compile windsurf
kernel compile junie
```

## Development Checks

Run all local checks before pushing:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm verify:packed
```

CI runs the same core checks on `main` and pull requests.

## Release Readiness

Kernel is not published to npm yet. Release gates, trusted-publishing setup notes, provenance expectations, and rollback checks are documented in `RELEASE.md`.

## JSON Outputs And Schemas

Machine-readable command outputs include `schemaVersion: 1`.

Discover schemas:

```bash
kernel schema versions --json
kernel schema list --json
kernel schema path validation-result --json
kernel schema show validation-result --json
```

Versioned schemas live under `schemas/json/v1/`.

## Public Repository Boundary

This public repository contains the Kernel CLI source, tests, schemas, release docs, and GitHub community files. Internal planning notes, task evidence, handoff packets, and private documentation vaults are intentionally excluded from public history.

## Contributing

See `CONTRIBUTING.md`. This repository uses Kernel's own task/evidence workflow for non-trivial changes.

## Security

See `SECURITY.md` for supported reporting channels and security handling expectations.

## License

Apache-2.0. See `LICENSE`.
