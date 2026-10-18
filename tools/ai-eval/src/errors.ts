// Errors that end a trial without it being the candidate's fault.

/**
 * The tool chain failed, not the candidate: `mtek` is missing, crashed, printed something that is not
 * its documented output, or the task's own fixtures are invalid. A trial that hits one ends with the
 * outcome `error`; it is neither a success nor a model failure, and is recorded as such.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

/** The run was configured in a way that cannot be honoured (a seed the client cannot apply, a missing option). Nothing runs. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
