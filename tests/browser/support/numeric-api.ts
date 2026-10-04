// The contract between the numeric probe page (`pages/numeric.ts`) and the numeric specs. Types only.

/** What one probe run read back. */
export interface NumericProbeResult {
  /** Four words per slot, slots row-major (`width * height * 4` words). */
  readonly words: readonly number[];
  /** Every `GPUCompilationInfo` message of the probe module ("type line:column text"). */
  readonly compilationMessages: readonly string[];
  /** Uncaptured GPU errors seen while the probe ran. */
  readonly errors: readonly string[];
}

export interface NumericApi {
  run(): Promise<NumericProbeResult>;
}

declare global {
  interface Window {
    __numeric?: NumericApi;
  }
}
