#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { getAdaptersForTarget } from '../adapters/index.js';
import { compileAdapters } from '../core/adapter-compiler.js';
import { createEvidenceLedger, createHandoffPacket, createTaskContract, addEvidenceCommand, showTaskContract } from '../core/artifacts.js';
import {
  formatSkillEvalJsonResult,
  formatSkillEvalResult,
  KernelEvalRunnerError,
  runSkillEvals
} from '../core/eval.js';
import { initializeKernel, type InitializeKernelResult } from '../core/init.js';
import { formatKernelJsonResult } from '../core/json-output.js';
import { generateKernelMaps } from '../core/maps.js';
import {
  getKernelSchemaDirectory,
  getKernelSchemaListResult,
  getKernelSchemaPathResult,
  getKernelSchemaShowResult,
  getKernelSchemaVersionsResult,
  KernelSchemaNotFoundError,
  KernelSchemaVersionNotFoundError,
  listKernelSchemas,
  readKernelSchema,
  resolveKernelSchemaPath
} from '../core/schema-registry.js';
import { generateCanonicalSkills, type GenerateCanonicalSkillsResult } from '../core/skill-generator.js';
import { formatSkillLintJsonResult, formatSkillLintResult, lintKernelSkills } from '../core/skills.js';
import { formatValidationJsonResult, formatValidationResult, validateKernel } from '../core/validate.js';
import {
  checkPolicy,
  formatPolicyCheckJsonResult,
  formatPolicyCheckResult
} from '../core/policy/check.js';
import { createCliJsonErrorEnvelope, formatCliJsonErrorEnvelope } from './json-errors.js';

export function createKernelProgram(): Command {
  const program = new Command();

  program
    .name('kernel')
    .description('Repo-local quality system and portable operating layer for coding agents.')
    .version('0.1.0');

  program
    .command('init')
    .description('Initialize Kernel in the current repository.')
    .option('--force', 'allow overwriting generated files')
    .option('--dry-run', 'show planned writes without changing files')
    .option('--adapters <list>', 'comma-separated adapter targets to enable in kernel.yaml')
    .action(async (options: { force?: boolean; dryRun?: boolean; adapters?: string }) => {
      try {
        const result = await initializeKernel(process.cwd(), {
          force: Boolean(options.force),
          dryRun: Boolean(options.dryRun),
          adapters: options.adapters
        });
        console.log(formatInitResult(result));
      } catch (error) {
        if (error instanceof Error && error.name === 'KernelInitError') {
          console.error(error.message);
          process.exitCode = 1;
          return;
        }

        throw error;
      }
    });

  program
    .command('map')
    .description('Generate deterministic Kernel repository maps.')
    .option('--force', 'allow overwriting map files')
    .option('--dry-run', 'show planned writes without changing files')
    .option('--include-docs-vault', 'include kernel_obsidian_vault in the scan')
    .option('--commands', 'generate only commands.json')
    .option('--tests', 'generate only tests.json')
    .option('--risk', 'generate only risk.json')
    .action(async (options: { force?: boolean; dryRun?: boolean; includeDocsVault?: boolean; commands?: boolean; tests?: boolean; risk?: boolean }) => {
      const maps: ('commands' | 'tests' | 'risk')[] = [];
      if (options.commands) {
        maps.push('commands');
      }
      if (options.tests) {
        maps.push('tests');
      }
      if (options.risk) {
        maps.push('risk');
      }

      const result = await generateKernelMaps(process.cwd(), {
        force: Boolean(options.force),
        dryRun: Boolean(options.dryRun),
        includeDocsVault: Boolean(options.includeDocsVault),
        maps: maps.length > 0 ? maps : undefined
      });
      console.log(formatArtifactResult(result.files));
    });

  program
    .command('validate')
    .description('Validate Kernel configuration and installation.')
    .option('--strict', 'treat warnings as errors')
    .option('--json', 'print machine-readable JSON')
    .action(async (options: { strict?: boolean; json?: boolean }) => {
      try {
        const result = await validateKernel(process.cwd(), {
          strict: Boolean(options.strict),
          throwConfigErrors: Boolean(options.json)
        });
        if (options.json) {
          process.stdout.write(formatValidationJsonResult(result));
        } else {
          console.log(formatValidationResult(result));
        }

        if (result.status === 'fail') {
          process.exitCode = 1;
        }
      } catch (error) {
        if (writeJsonErrorEnvelope('validate', Boolean(options.json), error)) {
          return;
        }

        throw error;
      }
    });

  const policy = program.command('policy').description('Evaluate Kernel policy rules.');
  policy
    .command('check')
    .description('Check commands, paths, task escalation, and CI policy compliance.')
    .option('--command <command>', 'classify a single command string')
    .option('--path <path>', 'classify a single repository path')
    .option('--task <task>', 'check verification escalation for a task (use current)')
    .option('--ci', 'check CI workflow compliance')
    .option('--strict', 'treat warnings as errors')
    .option('--json', 'print machine-readable JSON')
    .action(async (options: {
      command?: string;
      path?: string;
      task?: string;
      ci?: boolean;
      strict?: boolean;
      json?: boolean;
    }) => {
      try {
        const result = await checkPolicy({
          command: options.command,
          path: options.path,
          task: options.task,
          ci: Boolean(options.ci),
          strict: Boolean(options.strict)
        });

        if (options.json) {
          process.stdout.write(formatPolicyCheckJsonResult(result));
        } else {
          process.stdout.write(`${formatPolicyCheckResult(result)}\n`);
        }

        if (result.status === 'fail') {
          process.exitCode = 1;
        }
      } catch (error) {
        if (writeJsonErrorEnvelope('policy check', Boolean(options.json), error)) {
          return;
        }

        throw error;
      }
    });

  program
    .command('compile')
    .description('Compile Kernel canonical source into ADE-specific adapter files.')
    .argument('[target]', 'adapter target or all')
    .option('--force', 'allow overwriting generated adapter files')
    .option('--dry-run', 'show generated outputs without writing files')
    .action(async (target: string | undefined, options: { force?: boolean; dryRun?: boolean }) => {
      const result = await compileAdapters(process.cwd(), getAdaptersForTarget(target ?? 'all'), {
        force: Boolean(options.force),
        dryRun: Boolean(options.dryRun)
      });
      console.log(formatArtifactResult(result.files));
    });

  const task = program.command('task').description('Create and inspect Kernel task contracts.');
  task
    .command('new')
    .description('Create a task contract and update the current task state.')
    .requiredOption('--type <type>', 'task type')
    .requiredOption('--goal <goal>', 'task goal')
    .option('--id <id>', 'task id')
    .option('--non-goal <value>', 'non-goal entry', collectValues, [])
    .option('--risk <value>', 'risk zone entry', collectValues, [])
    .option('--verify <value>', 'verification entry', collectValues, [])
    .option('--force', 'allow overwriting the task contract')
    .option('--dry-run', 'show planned writes without changing files')
    .action(
      async (options: {
        type: string;
        goal: string;
        id?: string;
        nonGoal: string[];
        risk: string[];
        verify: string[];
        force?: boolean;
        dryRun?: boolean;
      }) => {
        const result = await createTaskContract(process.cwd(), {
          id: options.id,
          type: options.type,
          goal: options.goal,
          nonGoals: options.nonGoal,
          riskZones: options.risk,
          verification: options.verify,
          force: Boolean(options.force),
          dryRun: Boolean(options.dryRun)
        });
        console.log(formatArtifactResult(result.files));
      }
    );

  task
    .command('show')
    .description('Show the current task contract or a task contract by id.')
    .option('--id <id>', 'task id')
    .option('--json', 'print machine-readable JSON')
    .action(async (options: { id?: string; json?: boolean }) => {
      try {
        const result = await showTaskContract(process.cwd(), { id: options.id });
        if (options.json) {
          process.stdout.write(formatKernelJsonResult(result));
          return;
        }

        console.log(formatTaskContractView(result));
      } catch (error) {
        if (writeJsonErrorEnvelope('task show', Boolean(options.json), error)) {
          return;
        }

        if (error instanceof Error) {
          console.error(error.message);
          process.exitCode = 1;
          return;
        }

        throw error;
      }
    });

  const evidence = program.command('evidence').description('Create and update Kernel evidence ledgers.');
  evidence
    .command('new')
    .description('Create an evidence ledger for a task.')
    .option('--task <task>', 'task id or current', 'current')
    .option('--claim <claim>', 'initial claim')
    .option('--force', 'allow overwriting the evidence ledger')
    .option('--dry-run', 'show planned writes without changing files')
    .action(async (options: { task: string; claim?: string; force?: boolean; dryRun?: boolean }) => {
      const result = await createEvidenceLedger(process.cwd(), {
        task: options.task,
        claim: options.claim,
        force: Boolean(options.force),
        dryRun: Boolean(options.dryRun)
      });
      console.log(formatArtifactResult(result.files));
    });

  evidence
    .command('add-command')
    .description('Append a verification command to an evidence ledger.')
    .argument('<command>', 'verification command')
    .option('--task <task>', 'task id or current', 'current')
    .option('--exit-code <code>', 'command exit code')
    .option('--result <result>', 'command result summary')
    .option('--notes <notes>', 'additional notes')
    .option('--dry-run', 'show planned writes without changing files')
    .action(
      async (
        command: string,
        options: { task: string; exitCode?: string; result?: string; notes?: string; dryRun?: boolean }
      ) => {
        try {
          const result = await addEvidenceCommand(process.cwd(), {
            task: options.task,
            command,
            exitCode: options.exitCode,
            result: options.result,
            notes: options.notes,
            dryRun: Boolean(options.dryRun)
          });
          console.log(formatArtifactResult(result.files));
        } catch (error) {
          if (error instanceof Error) {
            console.error(error.message);
            process.exitCode = 1;
            return;
          }

          throw error;
        }
      }
    );

  const handoff = program.command('handoff').description('Create Kernel handoff packets.');
  handoff
    .command('new')
    .description('Create a handoff packet for a task.')
    .option('--task <task>', 'task id or current', 'current')
    .option('--force', 'allow overwriting the handoff packet')
    .option('--dry-run', 'show planned writes without changing files')
    .action(async (options: { task: string; force?: boolean; dryRun?: boolean }) => {
      const result = await createHandoffPacket(process.cwd(), {
        task: options.task,
        force: Boolean(options.force),
        dryRun: Boolean(options.dryRun)
      });
      console.log(formatArtifactResult(result.files));
    });

  const skill = program.command('skill').description('Lint and inspect Kernel skills.');
  skill
    .command('lint')
    .description('Lint canonical Kernel skill files and regression fixtures.')
    .option('--strict', 'treat warnings as errors')
    .option('--json', 'print machine-readable JSON')
    .action(async (options: { strict?: boolean; json?: boolean }) => {
      try {
        const result = await lintKernelSkills(process.cwd(), { strict: Boolean(options.strict) });
        if (options.json) {
          process.stdout.write(formatSkillLintJsonResult(result));
        } else {
          console.log(formatSkillLintResult(result));
        }

        if (result.status === 'fail') {
          process.exitCode = 1;
        }
      } catch (error) {
        if (writeJsonErrorEnvelope('skill lint', Boolean(options.json), error)) {
          return;
        }

        throw error;
      }
    });
  skill
    .command('generate')
    .description('Generate canonical Kernel skills from the documentation vault.')
    .option('--docs-vault <path>', 'documentation vault directory')
    .option('--set <set>', 'skill generation set: mvp or lint-ready')
    .option('--json', 'print machine-readable JSON')
    .option('--force', 'allow overwriting canonical skill files')
    .option('--dry-run', 'show planned skill writes without changing files')
    .action(async (options: { docsVault?: string; set?: string; json?: boolean; force?: boolean; dryRun?: boolean }) => {
      try {
        const result = await generateCanonicalSkills(process.cwd(), {
          docsVaultDir: options.docsVault,
          set: options.set,
          force: Boolean(options.force),
          dryRun: Boolean(options.dryRun)
        });
        if (options.json) {
          process.stdout.write(formatSkillGenerateJsonResult(result));
          return;
        }

        console.log(formatSkillGenerateResult(result));
      } catch (error) {
        if (writeJsonErrorEnvelope('skill generate', Boolean(options.json), error)) {
          return;
        }

        throw error;
      }
    });

  program
    .command('eval')
    .description('Run static Kernel skill regression fixtures.')
    .option('--skill <skill>', 'only pass the named skill and skip other validated fixtures')
    .option('--runner <runner>', 'eval runner id')
    .option('--summary <path>', 'write an evidence-ready Markdown summary')
    .option('--json', 'print machine-readable JSON')
    .option('--force', 'allow overwriting the summary file')
    .option('--dry-run', 'show planned summary writes without changing files')
    .action(
      async (options: {
        skill?: string;
        runner?: string;
        summary?: string;
        json?: boolean;
        force?: boolean;
        dryRun?: boolean;
      }) => {
        try {
          const result = await runSkillEvals(process.cwd(), {
            skill: options.skill,
            runnerId: options.runner,
            summaryPath: options.summary,
            force: Boolean(options.force),
            dryRun: Boolean(options.dryRun)
          });
          if (options.json) {
            process.stdout.write(formatSkillEvalJsonResult(result));
          } else {
            console.log(formatSkillEvalResult(result));
          }
        } catch (error) {
          if (writeJsonErrorEnvelope('eval', Boolean(options.json), error)) {
            return;
          }

          if (error instanceof KernelEvalRunnerError) {
            console.error(error.message);
            process.exitCode = 1;
            return;
          }

          throw error;
        }
      }
    );

  const schema = program.command('schema').description('Discover Kernel JSON Schema files.');
  schema
    .command('versions')
    .description('List supported Kernel JSON Schema versions.')
    .option('--json', 'print machine-readable JSON')
    .action((options: { json?: boolean }) => {
      if (options.json) {
        process.stdout.write(formatKernelJsonResult(getKernelSchemaVersionsResult()));
        return;
      }

      process.stdout.write(`${getKernelSchemaVersionsResult().versions.join('\n')}\n`);
    });
  schema
    .command('list')
    .description('List available Kernel JSON Schema names.')
    .option('--json', 'print machine-readable JSON')
    .option('--schema-version <version>', 'schema version to inspect')
    .action((options: { json?: boolean; schemaVersion?: string }) => {
      try {
        if (options.json) {
          process.stdout.write(formatKernelJsonResult(getKernelSchemaListResult(options.schemaVersion)));
          return;
        }

        process.stdout.write(`${listKernelSchemas(options.schemaVersion).map((entry) => entry.name).join('\n')}\n`);
      } catch (error) {
        if (writeJsonErrorEnvelope('schema list', Boolean(options.json), error)) {
          return;
        }

        if (error instanceof KernelSchemaVersionNotFoundError) {
          console.error(error.message);
          process.exitCode = 1;
          return;
        }

        throw error;
      }
    });
  schema
    .command('path')
    .description('Print the Kernel JSON Schema directory or a named schema file path.')
    .argument('[schema]', 'schema name or .schema.json filename')
    .option('--json', 'print machine-readable JSON')
    .option('--schema-version <version>', 'schema version to inspect')
    .action((schemaName: string | undefined, options: { json?: boolean; schemaVersion?: string }) => {
      try {
        if (options.json) {
          process.stdout.write(formatKernelJsonResult(getKernelSchemaPathResult(schemaName, options.schemaVersion)));
          return;
        }

        process.stdout.write(
          `${schemaName === undefined ? getKernelSchemaDirectory(options.schemaVersion) : resolveKernelSchemaPath(schemaName, options.schemaVersion)}\n`
        );
      } catch (error) {
        if (writeJsonErrorEnvelope('schema path', Boolean(options.json), error)) {
          return;
        }

        if (error instanceof KernelSchemaNotFoundError || error instanceof KernelSchemaVersionNotFoundError) {
          console.error(error.message);
          process.exitCode = 1;
          return;
        }

        throw error;
      }
    });
  schema
    .command('show')
    .description('Print a named Kernel JSON Schema file.')
    .argument('<schema>', 'schema name or .schema.json filename')
    .option('--json', 'print machine-readable JSON')
    .option('--schema-version <version>', 'schema version to inspect')
    .action(async (schemaName: string, options: { json?: boolean; schemaVersion?: string }) => {
      try {
        if (options.json) {
          process.stdout.write(formatKernelJsonResult(await getKernelSchemaShowResult(schemaName, options.schemaVersion)));
          return;
        }

        process.stdout.write(await readKernelSchema(schemaName, options.schemaVersion));
      } catch (error) {
        if (writeJsonErrorEnvelope('schema show', Boolean(options.json), error)) {
          return;
        }

        if (error instanceof KernelSchemaNotFoundError || error instanceof KernelSchemaVersionNotFoundError) {
          console.error(error.message);
          process.exitCode = 1;
          return;
        }

        throw error;
      }
    });

  return program;
}

function formatInitResult(result: InitializeKernelResult): string {
  const directoryLines = result.directories.map((entry) => `${entry.action}: ${entry.relativePath}`);
  const fileLines = result.files.map((entry) => `${entry.action}: ${entry.relativePath}`);
  return [...directoryLines, ...fileLines].join('\n');
}

function formatArtifactResult(files: { action: string; relativePath: string }[]): string {
  return files.map((entry) => `${entry.action}: ${entry.relativePath}`).join('\n');
}

function formatTaskContractView(view: {
  id: string;
  type: string;
  goal: string;
  relativePath: string;
}): string {
  return [`Task: ${view.id}`, `Type: ${view.type}`, `Goal: ${view.goal}`, `Path: ${view.relativePath}`].join('\n');
}

export function formatSkillGenerateResult(result: GenerateCanonicalSkillsResult): string {
  const lines = result.files.map((entry) => `${entry.action}: ${entry.relativePath}`);

  for (const skipped of result.skipped) {
    const reasons = skipped.reasons.map((reason) => `${reason.code}: ${reason.message}`).join('; ');
    lines.push(`skipped: ${skipped.relativePath} - ${reasons}`);
  }

  return lines.join('\n');
}

export function formatSkillGenerateJsonResult(result: GenerateCanonicalSkillsResult): string {
  return formatKernelJsonResult(result);
}

function writeJsonErrorEnvelope(command: string, json: boolean, error: unknown): boolean {
  if (!json) {
    return false;
  }

  const envelope = createCliJsonErrorEnvelope(command, error);
  if (envelope === null) {
    return false;
  }

  process.stdout.write(formatCliJsonErrorEnvelope(envelope));
  process.exitCode = 1;
  return true;
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createKernelProgram();
  await program.parseAsync(argv);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
