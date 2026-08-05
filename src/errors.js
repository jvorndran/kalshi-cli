export class CliError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = options.exitCode ?? 2;
    this.status = options.status;
    this.command = options.command;
    this.endpoint = options.endpoint;
    this.query = options.query;
    this.hint = options.hint;
    this.details = options.details;
  }
}

export function errorDocument(error) {
  const document = {
    error: {
      code: error.code ?? "unexpected_error",
      message: error.message || "An unexpected error occurred."
    }
  };

  for (const key of ["status", "command", "endpoint", "query", "hint", "details"]) {
    if (error[key] !== undefined) document.error[key] = error[key];
  }

  return document;
}
