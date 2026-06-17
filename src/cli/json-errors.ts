import { KernelConfigError } from '../core/config.js';
import { KernelContextError } from '../core/context/types.js';
import { KernelEvalRunnerError } from '../core/eval.js';
import { KernelFileExistsError } from '../core/fs.js';
import { formatKernelJsonResult } from '../core/json-output.js';
import { KernelSchemaNotFoundError, KernelSchemaVersionNotFoundError } from '../core/schema-registry.js';

export interface CliJsonErrorEnvelope {
  status: 'error';
  error: {
    code: string;
    command: string;
    message: string;
    path?: string;
    runnerId?: string;
    schemaName?: string;
    schemaVersionId?: string;
  };
}

export function createCliJsonErrorEnvelope(command: string, error: unknown): CliJsonErrorEnvelope | null {
  if (error instanceof KernelEvalRunnerError) {
    return {
      status: 'error',
      error: {
        code: error.code,
        command,
        message: error.message,
        runnerId: error.runnerId
      }
    };
  }

  if (error instanceof KernelContextError) {
    return {
      status: 'error',
      error: {
        code: error.code,
        command,
        message: error.message
      }
    };
  }

  if (error instanceof KernelConfigError) {
    return {
      status: 'error',
      error: {
        code: 'invalid_config',
        command,
        message: error.message,
        path: toJsonPath(error.configPath)
      }
    };
  }

  if (error instanceof KernelFileExistsError) {
    return {
      status: 'error',
      error: {
        code: 'file_exists',
        command,
        message: 'Refusing to overwrite existing file without force.',
        path: toJsonPath(error.targetPath)
      }
    };
  }

  if (error instanceof KernelSchemaNotFoundError) {
    return {
      status: 'error',
      error: {
        code: 'unknown_schema',
        command,
        message: error.message,
        schemaName: error.schemaName
      }
    };
  }

  if (error instanceof KernelSchemaVersionNotFoundError) {
    return {
      status: 'error',
      error: {
        code: 'unknown_schema_version',
        command,
        message: error.message,
        schemaVersionId: error.schemaVersionId
      }
    };
  }

  return null;
}

export function formatCliJsonErrorEnvelope(envelope: CliJsonErrorEnvelope): string {
  return formatKernelJsonResult(envelope);
}

function toJsonPath(path: string): string {
  return path.replace(/\\/g, '/');
}
