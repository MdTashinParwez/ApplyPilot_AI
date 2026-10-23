export class DatabaseUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Database operation failed", { cause });
    this.name = "DatabaseUnavailableError";
  }
}
