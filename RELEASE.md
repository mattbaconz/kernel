# Release Checklist

Kernel is not published to npm yet. This checklist prepares `@mattbaconz/kernel` for a future public npm release without enabling publication now.

## Current Gate

- Do not publish while `package.json` has `"private": true`.
- Do not remove `"private": true` except in a dedicated npm publication task.
- Do not publish from the private `mattbaconz/kernel-skills` repository.
- Use the public `mattbaconz/kernel` repository as the trusted publishing source.

## Package Metadata

- Package name: `@mattbaconz/kernel`
- License: Apache-2.0
- Copyright: `Copyright 2026 mattbaconz`
- Package files: `dist/` and `schemas/`
- Public package access: configured with `publishConfig.access: public`
- npm package remains unpublished until a separate explicit release task.

## Required Verification

Run these checks before any release tag or npm publication:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm verify:packed
npm pack --dry-run --json
```

Review the dry-run package contents and confirm they include only expected files:

- `LICENSE`
- `README.md`
- `package.json`
- `dist/`
- `schemas/`

## Trusted Publishing

Preferred release path is npm Trusted Publishing from GitHub Actions, not a long-lived npm token.

Before enabling publication:

1. Configure npm trusted publishing for `@mattbaconz/kernel`.
2. Set the trusted publisher to the public GitHub repository `mattbaconz/kernel`.
3. Set the workflow file to `.github/workflows/npm-release.yml`.
4. Confirm the workflow has `id-token: write`.
5. Confirm npm package ownership and 2FA settings for the `mattbaconz` account.

Trusted publishing uses OIDC. With trusted publishing, npm generates provenance attestations automatically. If trusted publishing is not available, do not fall back to a broad token without a separate release security review.

## Manual Workflow

The manual workflow `.github/workflows/npm-release.yml` is intentionally gated.

Default behavior:

- verifies the release artifact
- runs `npm pack --dry-run --json`
- refuses to publish because `enable_publish` defaults to `false`

Publication behavior:

- requires manual `workflow_dispatch`
- requires `enable_publish: true`
- refuses to publish while `package.json` has `"private": true`
- uses `npm publish --access public` only after the gates above pass

## Tag And Release

Before npm publication:

1. Confirm `CHANGELOG.md` has the intended version notes.
2. Confirm `package.json` version matches the release tag.
3. Create or verify the release tag, for example `v0.1.0`.
4. Confirm public CI is green on the tagged commit.
5. Create a GitHub Release after the tag is final.

## Rollback

npm packages cannot be treated like normal mutable deploys.

Use this rollback section for containment and follow-up when a release is wrong.

If a bad package is published:

1. Stop further publication.
2. Open a security or release issue if user impact is possible.
3. Deprecate the bad version on npm if appropriate.
4. Publish a fixed patch version instead of replacing the bad version.
5. Record evidence in the private source repository.
