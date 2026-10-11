const SECRET_RE = /\b[0-9a-f]{64}\b/g;

/** Hides tester tokens (and any other 64-hex secret) before rendered config is shown to people. */
export function redactSecrets(json: string): string {
  return json.replace(SECRET_RE, "‹redacted›");
}

type Named = { name?: unknown };
type VirtualHost = { domains?: unknown[]; routes?: Named[] };

/** The slice of a snapshot that belongs to one app: its clusters and its routes (tester route included). */
export function extractAppConfig(input: { clustersJson: string; routesJson: string; app: string; domain: string }): { clusters: unknown[]; routes: unknown[] } {
  const clusters = (JSON.parse(input.clustersJson) as Named[]).filter((c) => typeof c.name === "string" && c.name.startsWith(`${input.app}--`));
  const configs = JSON.parse(input.routesJson) as { virtual_hosts?: VirtualHost[] }[];
  const vhost = configs.flatMap((c) => c.virtual_hosts ?? []).find((v) => (v.domains ?? []).includes(input.domain));
  const routes = (vhost?.routes ?? []).filter((r) => r.name === input.app || r.name === `${input.app}.tester`);
  return { clusters, routes };
}
