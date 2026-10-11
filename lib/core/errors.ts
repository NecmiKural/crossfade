/** An expected, user-facing failure with a stable machine-readable code (API, forms, logs). */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
