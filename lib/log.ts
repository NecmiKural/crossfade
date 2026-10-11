type Level = "debug" | "info" | "warn" | "error";

/** One JSON line per event on stdout, so `docker compose logs` stays greppable. */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })}\n`);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
