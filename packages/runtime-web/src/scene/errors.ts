/** A runtime bug or a program that breaks the ABI in a way the compiler rules out. Never a user error. */
export class RuntimeInternalError extends Error {
  constructor(message: string) {
    super(`internal error: ${message}`);
    this.name = "RuntimeInternalError";
  }
}
