export const KERNEL_JSON_SCHEMA_VERSION = 1;

export type KernelJsonDocument<T extends object> = {
  schemaVersion: typeof KERNEL_JSON_SCHEMA_VERSION;
} & T;

export function withKernelJsonSchemaVersion<T extends object>(result: T): KernelJsonDocument<T> {
  return {
    schemaVersion: KERNEL_JSON_SCHEMA_VERSION,
    ...result
  };
}

export function formatKernelJsonResult<T extends object>(result: T): string {
  return `${JSON.stringify(withKernelJsonSchemaVersion(result), null, 2)}\n`;
}
