# Security Policy

Kernel is pre-release software and the repository is currently private.

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x | Yes, pre-release support |

## Reporting A Vulnerability

For now, report security concerns through a private GitHub issue or by contacting the repository owner directly.

Do not open public issues for exploitable vulnerabilities if the repository is made public later.

Please include:

- affected version or commit
- impacted command, adapter, schema, or generated file
- reproduction steps
- expected impact
- suggested mitigation, if known

## Security-Sensitive Areas

Treat these areas as high risk:

- file overwrite and safe-writer behavior
- generated adapter files
- config loading and schema validation
- command execution in release scripts
- package publishing and CI workflows
- future live eval runner integrations

## Handling Expectations

Security reports should receive an initial triage response before non-security feature work continues. Fixes should include regression coverage and evidence in `.agent/evidence/`.
