const SECRET_RE = /\b[0-9a-f]{64}\b/g;

/** Hides tester tokens (and any other 64-hex secret) before rendered config is shown to people. */
export function redactSecrets(json: string): string {
  return json.replace(SECRET_RE, "‹redacted›");
}
