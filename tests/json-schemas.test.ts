import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Ajv, type AnySchemaObject } from 'ajv';
import { afterEach, describe, expect, test } from 'vitest';

import { formatSkillGenerateJsonResult } from '../src/cli/index.js';
import { createCliJsonErrorEnvelope, formatCliJsonErrorEnvelope } from '../src/cli/json-errors.js';
import { KernelConfigError } from '../src/core/config.js';
import { KernelEvalRunnerError } from '../src/core/eval.js';
import { formatSkillEvalJsonResult, runSkillEvals } from '../src/core/eval.js';
import { KernelFileExistsError } from '../src/core/fs.js';
import { formatKernelJsonResult } from '../src/core/json-output.js';
import {
  getKernelSchemaPathResult,
  getKernelSchemaShowResult,
  getKernelSchemaVersionsResult,
  KernelSchemaNotFoundError,
  KernelSchemaVersionNotFoundError,
  listKernelSchemas
} from '../src/core/schema-registry.js';
import { formatSkillLintJsonResult, lintKernelSkills } from '../src/core/skills.js';
import { formatValidationJsonResult, validateKernel } from '../src/core/validate.js';

const repoRoot = process.cwd();
const schemaRoot = join(repoRoot, 'schemas', 'json', 'v1');
const tempDirs: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `kernel-json-schema-${name}-`));
  tempDirs.push(dir);
  await cp(join(repoRoot, 'tests', 'fixtures', name), dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Kernel JSON Schema v1', () => {
  test('validates JSON formatter outputs against versioned schema files', async () => {
    await expectSchemaValid(
      'skill-eval-result.schema.json',
      JSON.parse(
        formatSkillEvalJsonResult(
          await runSkillEvals(await copyFixture('eval-skills'), {
            skill: 'kernel-core',
            summaryPath: '.agent/evidence/eval-summary.md',
            dryRun: true
          })
        )
      )
    );

    await expectSchemaValid(
      'skill-lint-result.schema.json',
      JSON.parse(formatSkillLintJsonResult(await lintKernelSkills(await copyFixture('skills-invalid'), { strict: true })))
    );

    await expectSchemaValid(
      'validation-result.schema.json',
      JSON.parse(formatValidationJsonResult(await validateKernel(await copyFixture('validate-warnings'), { strict: true })))
    );

    await expectSchemaValid(
      'skill-generate-result.schema.json',
      JSON.parse(
        formatSkillGenerateJsonResult({
          generationSet: 'lint-ready',
          dryRun: true,
          skills: ['debug-probe'],
          files: [
            {
              action: 'would-create',
              relativePath: '.agent/skills/debug-probe/SKILL.md',
              path: 'C:/repo/.agent/skills/debug-probe/SKILL.md'
            }
          ],
          skipped: [
            {
              skillName: 'unready-skill',
              relativePath: '03-skills/unready-skill.md',
              reasons: [
                {
                  code: 'missing_output_artifact',
                  message: 'Skill doc output must mention a `.agent/` artifact or state that no artifact is produced.'
                }
              ]
            }
          ]
        })
      )
    );

    await expectSchemaValid(
      'schema-list-result.schema.json',
      JSON.parse(formatKernelJsonResult({ schemas: listKernelSchemas() }))
    );

    await expectSchemaValid(
      'schema-path-result.schema.json',
      JSON.parse(formatKernelJsonResult(getKernelSchemaPathResult('skill-eval-result')))
    );

    await expectSchemaValid(
      'schema-show-result.schema.json',
      JSON.parse(formatKernelJsonResult(await getKernelSchemaShowResult('skill-eval-result')))
    );

    await expectSchemaValid(
      'schema-versions-result.schema.json',
      JSON.parse(formatKernelJsonResult(getKernelSchemaVersionsResult()))
    );
  });

  test('validates JSON error envelopes against the versioned error schema', async () => {
    const runnerError = createCliJsonErrorEnvelope(
      'eval',
      new KernelEvalRunnerError(
        'unknown_runner',
        'unknown',
        'Unknown eval runner `unknown`. Available safe runners: static.'
      )
    );
    const configError = createCliJsonErrorEnvelope(
      'validate',
      new KernelConfigError('Invalid Kernel config in .agent/kernel.yaml.', 'C:/repo/.agent/kernel.yaml')
    );
    const fileError = createCliJsonErrorEnvelope(
      'skill generate',
      new KernelFileExistsError('C:/repo/.agent/skills/kernel-core/SKILL.md')
    );
    const schemaError = createCliJsonErrorEnvelope('schema path', new KernelSchemaNotFoundError('missing-schema'));
    const versionError = createCliJsonErrorEnvelope('schema path', new KernelSchemaVersionNotFoundError('v2'));

    expect(runnerError).not.toBeNull();
    expect(configError).not.toBeNull();
    expect(fileError).not.toBeNull();
    expect(schemaError).not.toBeNull();
    expect(versionError).not.toBeNull();

    await expectSchemaValid('error-envelope.schema.json', JSON.parse(formatCliJsonErrorEnvelope(runnerError!)));
    await expectSchemaValid('error-envelope.schema.json', JSON.parse(formatCliJsonErrorEnvelope(configError!)));
    await expectSchemaValid('error-envelope.schema.json', JSON.parse(formatCliJsonErrorEnvelope(fileError!)));
    await expectSchemaValid('error-envelope.schema.json', JSON.parse(formatCliJsonErrorEnvelope(schemaError!)));
    await expectSchemaValid('error-envelope.schema.json', JSON.parse(formatCliJsonErrorEnvelope(versionError!)));
  });
});

async function expectSchemaValid(schemaName: string, document: unknown): Promise<void> {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const schema = await readSchema(schemaName);
  const validate = ajv.compile(schema);
  const valid = validate(document);

  expect(validate.errors).toBeNull();
  expect(valid).toBe(true);
}

async function readSchema(schemaName: string): Promise<AnySchemaObject> {
  return JSON.parse(await readFile(join(schemaRoot, schemaName), 'utf8')) as AnySchemaObject;
}
